import { DOM_REF_ATTR } from './field-detector';
import type { InsertFieldRequest, InsertFieldResult } from './messaging';

// Writing a reviewed answer into the live page. Kept out of the content script
// entrypoint so it can be unit-tested against a DOM directly, and free of
// extension APIs for the same reason.

/** Longest excerpt of the user's text echoed back inside an error message. */
const EXCERPT = 40;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function excerpt(text: string): string {
  const flat = collapse(text);
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT)}…`;
}

/**
 * Find the element a `domRef` points at, descending into open shadow roots.
 *
 * `document.querySelector` alone would miss the shadow-DOM fields the detector
 * deliberately reaches into, so the same traversal is repeated here.
 */
function findByDomRef(root: Document | ShadowRoot, domRef: string): Element | null {
  const direct = root.querySelector(`[${DOM_REF_ATTR}="${domRef}"]`);
  if (direct) return direct;

  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = (el as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (shadow) {
      const found = findByDomRef(shadow, domRef);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The `value` setter from the element's own prototype.
 *
 * React — and Vue, Angular, Svelte — keep their own copy of an input's value and
 * overwrite a plain `element.value = x` on the next render, so the write has to
 * go through the native descriptor. Returns null when the element has no such
 * setter, which is the signal to fill it some other way.
 */
function nativeValueSetter(el: Element): ((value: string) => void) | null {
  const prototype =
    el instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : null;
  if (!prototype) return null;

  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  return setter ? (value: string) => setter.call(el, value) : null;
}

/**
 * Announce the edit.
 *
 * `input` is the event frameworks listen to for text edits — without it React
 * never learns the value changed and reverts it on the next render. `change` is
 * what plain forms and validation code listen to, and a programmatic fill is a
 * finished edit rather than a keystroke, so both are correct to send.
 */
function announceEdit(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function failure(error: string): InsertFieldResult {
  return { success: false, error };
}

/**
 * Confirm the field kept what was written, and describe it if not.
 *
 * A typed input sanitises what it is given — text written into `type="number"`
 * or `type="date"` comes straight back as an empty string — and claiming an
 * answer was inserted when the field is empty is the one thing the review panel
 * must never do. `maxlength` is not enforced on programmatic writes, so a short
 * result means the page rejected the value rather than trimmed it.
 */
function verifyWritten(written: string, wanted: string, kind: string): InsertFieldResult {
  if (written === wanted) return { success: true };

  const what = kind.length > 0 ? `This ${kind} field` : 'This field';
  if (written.length === 0) {
    return failure(`${what} would not accept "${excerpt(wanted)}" — fill it in yourself.`);
  }
  return failure(
    `${what} kept only ${written.length} of ${wanted.length} characters. Check it before submitting.`,
  );
}

function fillTextField(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): InsertFieldResult {
  const setValue = nativeValueSetter(el);
  if (setValue) setValue(text);
  // No native setter should be impossible for these two, but a plain assignment
  // is a better outcome than refusing to insert at all.
  else el.value = text;

  announceEdit(el);
  return verifyWritten(el.value, text, el instanceof HTMLInputElement ? el.type : '');
}

function fillSelect(el: HTMLSelectElement, text: string): InsertFieldResult {
  const wanted = collapse(text).toLowerCase();
  const option = Array.from(el.options).find(
    (candidate) =>
      candidate.value.trim().toLowerCase() === wanted ||
      collapse(candidate.textContent ?? '').toLowerCase() === wanted,
  );
  // A dropdown can only hold one of its own options, so anything else is a
  // choice for the user to make rather than something to force.
  if (!option) {
    return failure(
      `"${excerpt(text)}" is not one of this dropdown's options — choose it yourself.`,
    );
  }

  const setValue = nativeValueSetter(el);
  if (setValue) setValue(option.value);
  else el.value = option.value;

  announceEdit(el);
  return el.value === option.value
    ? { success: true }
    : failure('The dropdown did not accept that option.');
}

function isEditable(el: Element): boolean {
  const attr = el.getAttribute('contenteditable');
  return attr === '' || attr === 'true' || attr === 'plaintext-only';
}

function fillEditable(el: Element, text: string): InsertFieldResult {
  // Plain text, deliberately: writing the draft as HTML would let page-derived
  // markup into an element the page then reads back.
  el.textContent = text;
  announceEdit(el);
  return verifyWritten(el.textContent ?? '', text, '');
}

/**
 * Write `finalText` into the field `domRef` points at.
 *
 * Every outcome is reported through the return value — the panel shows the
 * result on the card, so a failure has to arrive as a sentence the user can act
 * on rather than as a thrown error or a silent no-op.
 */
export function insertIntoField(
  root: Document,
  { domRef, finalText }: InsertFieldRequest,
): InsertFieldResult {
  // The ref arrives over a message, and it is interpolated into a selector.
  if (!/^[A-Za-z0-9_-]+$/.test(domRef)) return failure('Unrecognised field reference.');

  const el = findByDomRef(root, domRef);
  if (!el) {
    return failure('That field is no longer on the page. Rescan the page and try again.');
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return fillTextField(el, finalText);
  }
  if (el instanceof HTMLSelectElement) return fillSelect(el, finalText);
  if (isEditable(el)) return fillEditable(el, finalText);

  // A widget the detector recognised by ARIA role but that holds no text of its
  // own — a listbox, a radio group. Say so instead of appearing to fill it.
  return failure(
    `This ${el.tagName.toLowerCase()} field cannot be filled automatically — copy the draft and set it yourself.`,
  );
}
