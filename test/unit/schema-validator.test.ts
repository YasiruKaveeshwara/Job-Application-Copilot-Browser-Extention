import { describe, it, expect } from 'vitest';
import { validateGeneratedAnswers, SchemaValidationError } from '../../lib/schema-validator';

const wellFormed = [
  { tempId: 'f0', classifiedType: 'cover-letter', confidence: 'high', draftAnswer: 'Dear team,' },
  { tempId: 'f1', classifiedType: 'name', confidence: 'low', draftAnswer: '' },
];

describe('validateGeneratedAnswers', () => {
  it('accepts a well-formed array of answers', () => {
    expect(validateGeneratedAnswers(wellFormed)).toEqual(wellFormed);
  });

  it('accepts a raw JSON string, as returned by the model', () => {
    expect(validateGeneratedAnswers(JSON.stringify(wellFormed))).toEqual(wellFormed);
  });

  it('unwraps a fenced json code block', () => {
    const fenced = '```json\n' + JSON.stringify(wellFormed) + '\n```';
    expect(validateGeneratedAnswers(fenced)).toEqual(wellFormed);
  });

  it('accepts an empty array', () => {
    expect(validateGeneratedAnswers([])).toEqual([]);
  });

  it('drops unrecognized keys instead of rejecting the answer', () => {
    const withExtras = [{ ...wellFormed[0]!, rationale: 'because', tokens: 42 }];
    expect(validateGeneratedAnswers(withExtras)).toEqual([wellFormed[0]]);
  });

  it('rejects prose wrapped around the JSON', () => {
    const withProse = `Sure! Here are your answers:\n${JSON.stringify(wellFormed)}\nLet me know.`;
    expect(() => validateGeneratedAnswers(withProse)).toThrow(SchemaValidationError);
    expect(() => validateGeneratedAnswers(withProse)).toThrow(/not valid JSON/);
  });

  it('rejects an empty response', () => {
    expect(() => validateGeneratedAnswers('   ')).toThrow(/empty response/);
  });

  it('rejects a non-array top level', () => {
    expect(() => validateGeneratedAnswers({ answers: wellFormed })).toThrow(
      /Expected a JSON array/,
    );
    expect(() => validateGeneratedAnswers(JSON.stringify(wellFormed[0]))).toThrow(
      /Expected a JSON array/,
    );
  });

  it('rejects a missing required field', () => {
    const missing = [{ classifiedType: 'name', confidence: 'high', draftAnswer: 'Ada' }];
    expect(() => validateGeneratedAnswers(missing)).toThrow(SchemaValidationError);
    expect(() => validateGeneratedAnswers(missing)).toThrow(/tempId must be a non-empty string/);
  });

  it('rejects a wrong type on draftAnswer', () => {
    const wrongType = [{ ...wellFormed[0]!, draftAnswer: 123 }];
    expect(() => validateGeneratedAnswers(wrongType)).toThrow(/draftAnswer must be a string/);
  });

  it('rejects a confidence value outside the allowed set', () => {
    const wrongEnum = [{ ...wellFormed[0]!, confidence: 'medium' }];
    expect(() => validateGeneratedAnswers(wrongEnum)).toThrow(/confidence must be "high" or "low"/);
  });

  it('rejects a non-object array entry', () => {
    expect(() => validateGeneratedAnswers(['just a string'])).toThrow(/expected an object/);
    expect(() => validateGeneratedAnswers([null])).toThrow(/expected an object, got null/);
  });

  it('reports every problem it found, not just the first', () => {
    let error: unknown;
    try {
      validateGeneratedAnswers([
        { tempId: '', classifiedType: '', confidence: 'x', draftAnswer: 1 },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SchemaValidationError);
    expect((error as SchemaValidationError).issues).toHaveLength(4);
  });

  it('throws rather than returning a partial array when one entry is bad', () => {
    const mixed = [wellFormed[0]!, { tempId: 'f1' }];
    expect(() => validateGeneratedAnswers(mixed)).toThrow(SchemaValidationError);
  });
});
