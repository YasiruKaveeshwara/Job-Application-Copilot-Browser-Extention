import { describe, it, expect } from 'vitest';
import {
  detectFields,
  extractPageText,
  PAGE_TEXT_BUDGET,
  DOM_REF_ATTR,
} from '../../lib/field-detector';
import type { DetectedField } from '../../lib/types';

function setBody(html: string) {
  document.body.innerHTML = html;
}

/** Detect and return the single expected field, failing loudly if absent. */
function onlyField(): DetectedField {
  const fields = detectFields(document);
  expect(fields).toHaveLength(1);
  return fields[0]!;
}

describe('detectFields — label resolution', () => {
  it('resolves an explicitly associated label[for] as structured', () => {
    setBody(`
      <form>
        <label for="full-name">Full Name</label>
        <input id="full-name" type="text" />
      </form>
    `);

    const field = onlyField();
    expect(field.resolvedLabel).toBe('Full Name');
    expect(field.labelConfidence).toBe('structured');
    expect(field.elementType).toBe('input:text');
  });

  it('resolves an implicitly wrapping label as structured', () => {
    setBody(`<label>Email Address <input type="email" /></label>`);

    const field = onlyField();
    expect(field.resolvedLabel).toBe('Email Address');
    expect(field.labelConfidence).toBe('structured');
  });

  it('resolves aria-label as structured when no <label> exists', () => {
    setBody(`<input type="tel" aria-label="Phone Number" />`);

    const field = onlyField();
    expect(field.resolvedLabel).toBe('Phone Number');
    expect(field.labelConfidence).toBe('structured');
  });

  it('resolves aria-labelledby by following the id reference', () => {
    setBody(`
      <span id="linkedin-label">LinkedIn URL</span>
      <input type="url" aria-labelledby="linkedin-label" />
    `);

    const field = onlyField();
    expect(field.resolvedLabel).toBe('LinkedIn URL');
    expect(field.labelConfidence).toBe('structured');
  });

  it('falls through to proximity and still returns a non-empty label', () => {
    setBody(`
      <form>
        <p>Years of Experience</p>
        <input id="experience" type="number" placeholder="e.g. 5" />
      </form>
    `);

    const field = onlyField();
    expect(field.resolvedLabel).toBe('Years of Experience');
    expect(field.labelConfidence).toBe('proximity');
    expect(field.resolvedLabel.length).toBeGreaterThan(0);
  });

  it("does not steal the preceding field's label across another input", () => {
    setBody(`
      <form>
        <div>Portfolio Website</div>
        <input id="portfolio" type="url" />
        <input id="unlabeled" type="text" placeholder="untitled" />
      </form>
    `);

    const fields = detectFields(document);
    const unlabeled = fields.find((f) => f.elementType === 'input:text');
    // Must not inherit "Portfolio Website" — that labels the previous input.
    expect(unlabeled?.resolvedLabel).toBe('untitled');
    expect(unlabeled?.labelConfidence).toBe('proximity');
  });
});

describe('detectFields — element selection', () => {
  it('excludes non-form-relevant elements such as a plain <div>', () => {
    setBody(`
      <div>Just descriptive text, not an input.</div>
      <span>Also not a field.</span>
    `);

    expect(detectFields(document)).toHaveLength(0);
  });

  it('includes textarea, contenteditable and role:textbox fields', () => {
    setBody(`
      <label for="cover">Cover Letter</label>
      <textarea id="cover"></textarea>
      <div contenteditable="true" aria-label="Rich Answer"></div>
      <div role="textbox" aria-label="Role Textbox"></div>
    `);

    const types = detectFields(document).map((f) => f.elementType);
    expect(types).toContain('textarea');
    expect(types).toContain('contenteditable');
    expect(types).toContain('role:textbox');
  });

  it('excludes select, combobox, checkbox, radio and switch elements', () => {
    setBody(`
      <select id="country" aria-label="Country"><option>US</option></select>
      <div role="combobox" aria-label="Combo"></div>
      <div role="listbox" aria-label="List"></div>
      <input type="checkbox" aria-label="Agree" />
      <input type="radio" aria-label="Option A" />
      <div role="checkbox" aria-label="Toggle"></div>
      <div role="switch" aria-label="Dark Mode"></div>
      <div role="radiogroup" aria-label="Choices"></div>
      <input type="text" aria-label="Real Field" />
    `);

    const fields = detectFields(document);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.resolvedLabel).toBe('Real Field');
  });

  it('excludes hidden, submit and button inputs, and contenteditable="false"', () => {
    setBody(`
      <input type="hidden" name="csrf" value="tok" />
      <input type="submit" value="Apply" />
      <button type="button">Click</button>
      <div contenteditable="false">Read only</div>
      <input type="text" aria-label="Real Field" />
    `);

    const field = onlyField();
    expect(field.resolvedLabel).toBe('Real Field');
  });

  it('descends into an open shadow root', () => {
    setBody(`<div id="host"></div>`);
    const host = document.getElementById('host')!;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <label for="shadow-input">Shadow Field</label>
      <input id="shadow-input" type="text" />
    `;

    const field = onlyField();
    expect(field.resolvedLabel).toBe('Shadow Field');
    expect(field.labelConfidence).toBe('structured');
  });
});

describe('detectFields — identifiers and context', () => {
  it('assigns unique tempIds and stamps a stable domRef attribute', () => {
    setBody(`
      <input type="text" aria-label="One" />
      <input type="text" aria-label="Two" />
    `);

    const fields = detectFields(document);
    expect(fields).toHaveLength(2);
    expect(new Set(fields.map((f) => f.tempId)).size).toBe(2);
    expect(new Set(fields.map((f) => f.domRef)).size).toBe(2);

    for (const f of fields) {
      // domRef must resolve back to exactly one live element.
      expect(document.querySelectorAll(`[${DOM_REF_ATTR}="${f.domRef}"]`)).toHaveLength(1);
    }
  });

  it('reuses an existing domRef across repeated scans', () => {
    setBody(`<input type="text" aria-label="Stable" />`);

    const first = onlyField().domRef;
    const second = onlyField().domRef;
    expect(second).toBe(first);
  });

  it('captures currentValue and surroundingText', () => {
    setBody(`
      <p>
        <label for="name">Full Name</label>
        <input id="name" type="text" value="Ada" />
      </p>
    `);

    const field = onlyField();
    expect(field.currentValue).toBe('Ada');
    expect(field.surroundingText).toContain('Full Name');
  });
});

describe('extractPageText', () => {
  it('collapses whitespace and returns trimmed text', () => {
    setBody(`<h1>Senior   Engineer</h1>\n\n<p>We   are hiring.</p>`);
    const text = extractPageText();
    expect(text).toContain('Senior Engineer');
    expect(text).not.toMatch(/\s{2,}/);
  });

  it('truncates to the documented character budget', () => {
    setBody(`<p>${'x'.repeat(PAGE_TEXT_BUDGET + 500)}</p>`);
    expect(extractPageText().length).toBeLessThanOrEqual(PAGE_TEXT_BUDGET);
  });
});
