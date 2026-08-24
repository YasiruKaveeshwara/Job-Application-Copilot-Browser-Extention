import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sendMessage, onMessage } from '../../lib/messaging';
import type { DetectedField, JobContext, GeneratedAnswer } from '../../lib/types';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    tempId: 'f0',
    resolvedLabel: 'Cover Letter',
    labelConfidence: 'structured',
    elementType: 'textarea',
    domRef: 'jac-1',
    currentValue: '',
    surroundingText: 'Cover Letter',
    ...overrides,
  };
}

const context: JobContext = {
  rawText: 'We are hiring a software engineer.',
  url: 'https://jobs.example.com/1',
  pageTitle: 'Software Engineer',
};

describe('messaging contracts', () => {
  const removers: (() => void)[] = [];

  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    while (removers.length) removers.pop()?.();
  });

  it('round-trips TRIGGER_SCAN with fields and context', async () => {
    removers.push(onMessage('TRIGGER_SCAN', () => ({ fields: [field()], context })));

    const result = await sendMessage('TRIGGER_SCAN', undefined);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.resolvedLabel).toBe('Cover Letter');
    expect(result.context.pageTitle).toBe('Software Engineer');
  });

  it('round-trips REQUEST_GENERATION and returns GeneratedAnswer[]', async () => {
    const answers: GeneratedAnswer[] = [
      { tempId: 'f0', classifiedType: 'cover-letter', confidence: 'high', draftAnswer: 'Hello.' },
    ];
    removers.push(
      onMessage('REQUEST_GENERATION', ({ data }) => {
        // The handler receives the full typed request.
        expect(data.fields).toHaveLength(1);
        expect(data.context.url).toContain('jobs.example.com');
        return answers;
      }),
    );

    const result = await sendMessage('REQUEST_GENERATION', { fields: [field()], context });
    expect(result).toEqual(answers);
  });

  it('round-trips INSERT_FIELD and reports success', async () => {
    removers.push(
      onMessage('INSERT_FIELD', ({ data }) => {
        expect(data.domRef).toBe('jac-1');
        expect(data.finalText).toBe('Final answer');
        return { success: true };
      }),
    );

    const result = await sendMessage('INSERT_FIELD', {
      domRef: 'jac-1',
      finalText: 'Final answer',
    });
    expect(result.success).toBe(true);
  });

  it('round-trips SAVE_FIELD_MAPPING', async () => {
    const saved: string[] = [];
    removers.push(
      onMessage('SAVE_FIELD_MAPPING', ({ data }) => {
        saved.push(`${data.domain}|${data.resolvedLabel}|${data.correctedType}`);
      }),
    );

    await sendMessage('SAVE_FIELD_MAPPING', {
      domain: 'jobs.example.com',
      resolvedLabel: 'Why us?',
      correctedType: 'motivation',
    });
    expect(saved).toEqual(['jobs.example.com|Why us?|motivation']);
  });

  it('surfaces a handler error as a rejection the caller can catch', async () => {
    removers.push(
      onMessage('REQUEST_GENERATION', () => {
        throw new Error('generation failed');
      }),
    );

    // The UI can try/catch rather than inspecting a sentinel value.
    await expect(sendMessage('REQUEST_GENERATION', { fields: [field()], context })).rejects.toThrow(
      /generation failed/,
    );
  });

  it('round-trips FETCH_AVAILABLE_MODELS and GET_AVAILABLE_MODELS', async () => {
    const models = [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }];
    removers.push(
      onMessage('FETCH_AVAILABLE_MODELS', ({ data }) => {
        expect(data?.apiKey).toBe('test-key');
        return models;
      }),
    );
    removers.push(onMessage('GET_AVAILABLE_MODELS', () => models));

    const fetched = await sendMessage('FETCH_AVAILABLE_MODELS', { apiKey: 'test-key' });
    expect(fetched).toEqual(models);

    const cached = await sendMessage('GET_AVAILABLE_MODELS', undefined);
    expect(cached).toEqual(models);
  });
});
