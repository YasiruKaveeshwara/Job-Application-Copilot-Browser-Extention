import { describe, it, expect, beforeEach } from 'vitest';
import { insertIntoField } from '../../lib/insert-handler';
import { detectFields } from '../../lib/field-detector';
import type { InsertFieldResult } from '../../lib/messaging';

// The framework-controlled case needs a real browser and lives in
// test/e2e/insert-handler.spec.ts. What is checked here is everything that does
// not: which element a domRef resolves to, how each kind of field is filled, and
// that every refusal explains itself.

/** Render a page, scan it, and return the domRef of the field at `index`. */
function refFor(html: string, index = 0): string {
  document.body.innerHTML = html;
  const fields = detectFields(document);
  const field = fields[index];
  expect(field, `no field at index ${index} in ${html}`).toBeDefined();
  return field!.domRef;
}

function insert(domRef: string, finalText: string): InsertFieldResult {
  return insertIntoField(document, { domRef, finalText });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('insertIntoField', () => {
  it('fills a plain text input and announces the edit', () => {
    const ref = refFor('<label for="a">Full Name</label><input id="a" />');
    const input = document.querySelector('input')!;
    const events: string[] = [];
    for (const type of ['input', 'change']) {
      input.addEventListener(type, () => events.push(type));
    }

    expect(insert(ref, 'Yasiru Kaveeshwara')).toEqual({ success: true });
    expect(input.value).toBe('Yasiru Kaveeshwara');
    // Without these the page's own state never learns the value changed.
    expect(events).toEqual(['input', 'change']);
  });

  it('fills a textarea, newlines and all', () => {
    const ref = refFor('<label for="a">Cover Letter</label><textarea id="a"></textarea>');
    const text = 'First paragraph.\n\nSecond paragraph.';

    expect(insert(ref, text)).toEqual({ success: true });
    expect(document.querySelector('textarea')!.value).toBe(text);
  });

  it('replaces an existing value rather than appending to it', () => {
    const ref = refFor('<label for="a">Full Name</label><input id="a" value="old text" />');

    expect(insert(ref, 'new text').success).toBe(true);
    expect(document.querySelector('input')!.value).toBe('new text');
  });

  it('writes into a contenteditable as text, not as markup', () => {
    const ref = refFor('<label for="a">Bio</label><div id="a" contenteditable></div>');
    const editable = document.querySelector('#a')!;

    expect(insert(ref, '<b>not bold</b>')).toEqual({ success: true });
    expect(editable.textContent).toBe('<b>not bold</b>');
    // Page-derived markup must not become live nodes in the page.
    expect(editable.querySelector('b')).toBeNull();
  });

  it('picks the matching option of a dropdown, by visible text or by value', () => {
    const html = `
      <label for="a">Country</label>
      <select id="a">
        <option value="">Select…</option>
        <option value="us">United States</option>
        <option value="lk">Sri Lanka</option>
      </select>`;

    const ref = refFor(html);
    const select = document.querySelector('select')!;

    expect(insert(ref, 'Sri Lanka')).toEqual({ success: true });
    expect(select.value).toBe('lk');

    expect(insert(ref, ' us ')).toEqual({ success: true });
    expect(select.value).toBe('us');
  });

  it('refuses to force a dropdown to a value it does not offer', () => {
    const ref = refFor(
      '<label for="a">Country</label><select id="a"><option value="us">United States</option></select>',
    );

    const result = insert(ref, 'Atlantis');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Atlantis/);
    expect(result.error).toMatch(/choose it yourself/);
    // The existing selection is left exactly as it was.
    expect(document.querySelector('select')!.value).toBe('us');
  });

  it('reports a field that has gone from the page instead of failing silently', () => {
    const ref = refFor('<label for="a">Full Name</label><input id="a" />');
    document.body.innerHTML = '<p>The form was replaced.</p>';

    const result = insert(ref, 'anything');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no longer on the page/i);
    expect(result.error).toMatch(/[Rr]escan/);
  });

  it('rejects a domRef that is not one the detector could have produced', () => {
    // The ref arrives over a message and is interpolated into a selector.
    for (const bogus of ['a"]', 'a b', '', '*']) {
      expect(insert(bogus, 'x')).toEqual({
        success: false,
        error: 'Unrecognised field reference.',
      });
    }
  });

  it('finds a field inside an open shadow root', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<label for="s">Shadow Field</label><input id="s" />';

    const fields = detectFields(document);
    expect(fields).toHaveLength(1);

    expect(insert(fields[0]!.domRef, 'reached it')).toEqual({ success: true });
    expect(shadow.querySelector('input')!.value).toBe('reached it');
  });

  it('says so when a typed field refuses the text instead of claiming success', () => {
    // A "Years of experience" number input handed prose is the realistic case:
    // the browser sanitises it to an empty string, and "Written into the page"
    // beside an empty field would be a lie.
    const ref = refFor('<label for="a">Years of Experience</label><input id="a" type="number" />');

    const result = insert(ref, 'about five years');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/number field would not accept/);
    expect(result.error).toMatch(/about five years/);
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('explains that a widget with no text of its own cannot be filled', () => {
    const ref = refFor('<label for="a">Preference</label><div id="a" role="listbox"></div>');

    const result = insert(ref, 'Remote');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be filled automatically/);
    expect(result.error).toMatch(/copy the draft/);
  });
});
