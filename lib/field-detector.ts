import type { DetectedField } from './types';

// Universal field detection. Kept free of extension APIs and framework code so
// it can be unit-tested in happy-dom and injected directly in Playwright.

/** Attribute used to resolve a detected field back to its live element later. */
export const DOM_REF_ATTR = 'data-jac-id';

/**
 * Page-text budget for the job description, in characters.
 *
 * 12,000 chars ≈ 3,000–4,000 tokens. Real job descriptions (role summary,
 * responsibilities, requirements, benefits boilerplate) land well under this,
 * while it stays a small fraction of a batched prompt's cost and leaves plenty
 * of headroom for field lists and retrieved profile fragments. Truncation keeps
 * the head of the document, where the role title and summary live; the tail is
 * usually legal/EEO boilerplate with little signal.
 */
export const PAGE_TEXT_BUDGET = 12_000;

/** Max characters kept for a field's surrounding-text excerpt. */
const SURROUNDING_TEXT_BUDGET = 200;

/** ARIA roles that behave like form fields even on non-form elements. */
const FIELD_ROLES = ['textbox', 'combobox', 'listbox', 'radiogroup', 'checkbox', 'switch'];

const FIELD_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  ...FIELD_ROLES.map((r) => `[role="${r}"]`),
].join(', ');

/**
 * `<input>` types that never hold user-authored answers. Excluded so the
 * generator is never asked to write a value for a submit button or a hidden
 * CSRF token.
 */
const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);

let domRefCounter = 0;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd();
}

function escapeId(id: string): string {
  // CSS.escape isn't available in every test DOM implementation.
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/["\\]/g, '\\$&');
}

function isFieldElement(el: Element): boolean {
  if (!el.matches(FIELD_SELECTOR)) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (IGNORED_INPUT_TYPES.has(type)) return false;
  }
  // `[contenteditable]` also matches contenteditable="false".
  if (el.hasAttribute('contenteditable')) {
    const val = el.getAttribute('contenteditable');
    const editable = val === '' || val === 'true' || val === 'plaintext-only';
    const otherwiseField =
      ['input', 'textarea', 'select'].includes(tag) ||
      FIELD_ROLES.includes(el.getAttribute('role') ?? '');
    if (!editable && !otherwiseField) return false;
  }
  return true;
}

function elementType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') return `input:${(el.getAttribute('type') ?? 'text').toLowerCase()}`;
  if (tag === 'textarea' || tag === 'select') return tag;
  const role = el.getAttribute('role');
  if (role && FIELD_ROLES.includes(role)) return `role:${role}`;
  if (el.hasAttribute('contenteditable')) return 'contenteditable';
  return tag;
}

function currentValue(el: Element): string {
  const withValue = el as HTMLInputElement;
  if (typeof withValue.value === 'string') return withValue.value;
  return collapse(el.textContent ?? '');
}

/** Assign (or reuse) a stable per-element reference for later insertion. */
function ensureDomRef(el: Element): string {
  const existing = el.getAttribute(DOM_REF_ATTR);
  if (existing) return existing;
  const ref = `jac-${++domRefCounter}`;
  el.setAttribute(DOM_REF_ATTR, ref);
  return ref;
}

function textFromIdRefs(root: Document | ShadowRoot, idRefs: string): string {
  return collapse(
    idRefs
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target =
          root instanceof Document
            ? root.getElementById(id)
            : root.querySelector(`#${escapeId(id)}`);
        return target?.textContent ?? '';
      })
      .join(' '),
  );
}

/**
 * Nearest preceding text in DOM order, aborting if another field sits between
 * the text and this element — that text almost certainly labels the other
 * field, not this one.
 */
function precedingText(el: Element, root: Document | ShadowRoot): string {
  const scope: Node = root instanceof Document ? (root.body ?? root) : root;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);

  const ordered: Node[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    ordered.push(node);
    node = walker.nextNode();
  }

  const index = ordered.indexOf(el);
  if (index < 0) return '';

  for (let i = index - 1; i >= 0; i--) {
    const candidate = ordered[i];
    if (!candidate) continue;

    if (candidate.nodeType === Node.ELEMENT_NODE) {
      const element = candidate as Element;
      // An ancestor wrapper (<p>, <div>) is fine to cross; a sibling field is not.
      if (element.contains(el)) continue;
      if (isFieldElement(element)) return '';
      continue;
    }

    const parentTag = candidate.parentElement?.tagName.toLowerCase();
    if (parentTag === 'script' || parentTag === 'style') continue;
    const text = collapse(candidate.textContent ?? '');
    if (text) return text;
  }
  return '';
}

/**
 * Last-resort label guess: the visually closest text-bearing element, preferring
 * text above or to the left of the field (normal label placement). Needs real
 * layout, so it only contributes in a browser, not in a headless DOM.
 */
function nearestTextByDistance(el: Element, root: Document | ShadowRoot): string {
  let rect: DOMRect;
  try {
    rect = el.getBoundingClientRect();
  } catch {
    return '';
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) return '';

  const scope: ParentNode = root instanceof Document ? (root.body ?? root) : root;
  let best = '';
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of Array.from(scope.querySelectorAll('*'))) {
    if (candidate === el || candidate.contains(el) || isFieldElement(candidate)) continue;
    // Only leaf-ish text holders, to avoid scoring whole wrappers.
    if (candidate.children.length > 0) continue;

    const text = collapse(candidate.textContent ?? '');
    if (!text || text.length > 80) continue;

    let candidateRect: DOMRect;
    try {
      candidateRect = candidate.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!candidateRect || (candidateRect.width === 0 && candidateRect.height === 0)) continue;

    const dx = rect.left - candidateRect.right;
    const dy = rect.top - candidateRect.bottom;
    // Penalise text below or to the right of the field.
    const distance =
      Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
      (candidateRect.top > rect.bottom ? 1000 : 0) +
      (candidateRect.left > rect.right ? 500 : 0);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = text;
    }
  }
  return best;
}

function surroundingText(el: Element): string {
  const container =
    el.closest('label, fieldset, li, p, .form-group, div, form') ?? el.parentElement ?? el;
  return truncate(collapse(container.textContent ?? ''), SURROUNDING_TEXT_BUDGET);
}

function resolveLabel(
  el: Element,
  root: Document | ShadowRoot,
): { resolvedLabel: string; labelConfidence: DetectedField['labelConfidence'] } {
  // --- Tier 1: structured associations -------------------------------------
  const id = el.getAttribute('id');
  if (id) {
    const explicit = root.querySelector(`label[for="${escapeId(id)}"]`);
    const text = collapse(explicit?.textContent ?? '');
    if (text) return { resolvedLabel: text, labelConfidence: 'structured' };
  }

  // Implicit association: <label>Name <input /></label>. Not in the documented
  // priority list but equally structured, and common in real forms.
  const wrapping = el.closest('label');
  if (wrapping) {
    const text = collapse(wrapping.textContent ?? '');
    if (text) return { resolvedLabel: text, labelConfidence: 'structured' };
  }

  const ariaLabel = collapse(el.getAttribute('aria-label') ?? '');
  if (ariaLabel) return { resolvedLabel: ariaLabel, labelConfidence: 'structured' };

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = textFromIdRefs(root, labelledBy);
    if (text) return { resolvedLabel: text, labelConfidence: 'structured' };
  }

  // --- Tier 2: proximity fallbacks -----------------------------------------
  const preceding = precedingText(el, root);
  if (preceding) return { resolvedLabel: preceding, labelConfidence: 'proximity' };

  // An author-provided placeholder beats guessing by pixel distance.
  const placeholder = collapse(el.getAttribute('placeholder') ?? '');
  if (placeholder) return { resolvedLabel: placeholder, labelConfidence: 'proximity' };

  const byDistance = nearestTextByDistance(el, root);
  if (byDistance) return { resolvedLabel: byDistance, labelConfidence: 'proximity' };

  // --- Tier 3: nothing usable ----------------------------------------------
  return { resolvedLabel: '', labelConfidence: 'none' };
}

function collect(root: Document | ShadowRoot, out: DetectedField[]): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    // Descend into open shadow roots regardless of whether the host is a field.
    const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow) collect(shadow, out);

    if (!isFieldElement(el)) continue;

    const { resolvedLabel, labelConfidence } = resolveLabel(el, root);
    out.push({
      tempId: `f${out.length}`,
      resolvedLabel,
      labelConfidence,
      elementType: elementType(el),
      domRef: ensureDomRef(el),
      currentValue: currentValue(el),
      surroundingText: surroundingText(el),
    });
  }
}

/**
 * Detect every form-relevant field under `root`, descending into open shadow
 * roots. `tempId` is per-scan and cheap to put in a prompt; `domRef` is a stable
 * attribute used to resolve back to the live element for insertion.
 */
export function detectFields(root: Document | ShadowRoot): DetectedField[] {
  const out: DetectedField[] = [];
  collect(root, out);
  return out;
}

/** Visible page text, trimmed and truncated to {@link PAGE_TEXT_BUDGET}. */
export function extractPageText(): string {
  const body = document.body;
  if (!body) return '';
  const raw = (body as HTMLElement).innerText ?? body.textContent ?? '';
  return truncate(collapse(raw), PAGE_TEXT_BUDGET);
}
