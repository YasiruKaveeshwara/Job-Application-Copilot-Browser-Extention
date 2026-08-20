import { describe, it, expect, afterEach, vi } from 'vitest';
import { MockGenerator, classifyLabelLocally } from '../../lib/generator/mock-generator';
import { GeneratorError } from '../../lib/generator/types';
import type { BuiltPrompt } from '../../lib/generator/types';
import { validateGeneratedAnswers } from '../../lib/schema-validator';

function prompt(fields: BuiltPrompt['fields']): BuiltPrompt {
  return { system: 'system text', user: 'user text', fields };
}

const threeFields = prompt([
  { tempId: 'f0', resolvedLabel: 'Cover Letter', elementType: 'textarea' },
  { tempId: 'f1', resolvedLabel: 'Full Name', elementType: 'input:text' },
  { tempId: 'f2', resolvedLabel: '', elementType: 'input:text' },
]);

describe('MockGenerator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns exactly one answer per field, in order', async () => {
    const answers = await new MockGenerator().generate(threeFields);
    expect(answers.map((a) => a.tempId)).toEqual(['f0', 'f1', 'f2']);
  });

  it('produces output that passes the real schema validator', async () => {
    const answers = await new MockGenerator().generate(threeFields);
    expect(validateGeneratedAnswers(answers)).toEqual(answers);
  });

  it('is deterministic: identical input yields identical output', async () => {
    const generator = new MockGenerator();
    expect(await generator.generate(threeFields)).toEqual(await generator.generate(threeFields));
  });

  it('marks an unlabeled field low confidence', async () => {
    const answers = await new MockGenerator().generate(threeFields);
    expect(answers[0]!.confidence).toBe('high');
    expect(answers[2]!.confidence).toBe('low');
    expect(answers[2]!.classifiedType).toBe('unknown');
  });

  it('makes no network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await new MockGenerator().generate(threeFields);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty array for an empty field list', async () => {
    expect(await new MockGenerator().generate(prompt([]))).toEqual([]);
  });

  it('rejects with a GeneratorError when configured to fail', async () => {
    const generator = new MockGenerator({ failWith: 'simulated failure' });
    await expect(generator.generate(threeFields)).rejects.toThrow(GeneratorError);
    await expect(generator.generate(threeFields)).rejects.toThrow(/simulated failure/);
  });
});

describe('classifyLabelLocally', () => {
  it('recognizes the common application question types', () => {
    expect(classifyLabelLocally('Cover Letter')).toBe('cover-letter');
    expect(classifyLabelLocally('Why do you want to work here?')).toBe('motivation');
    expect(classifyLabelLocally('Full Name')).toBe('name');
    expect(classifyLabelLocally('Email Address')).toBe('email');
    expect(classifyLabelLocally('LinkedIn Profile')).toBe('url');
    expect(classifyLabelLocally('Expected Salary')).toBe('salary');
    expect(classifyLabelLocally('Do you require visa sponsorship?')).toBe('work-authorization');
  });

  it('falls back to "other" rather than guessing', () => {
    expect(classifyLabelLocally('Favourite Sandwich')).toBe('other');
  });
});
