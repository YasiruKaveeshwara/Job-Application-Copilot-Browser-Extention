import type { GeneratedAnswer } from '../types';
import type { BuiltPrompt, Generator, PromptFieldRef } from './types';
import { GeneratorError } from './types';

// Deterministic, offline, free. Every phase after this one is validated against
// MockGenerator first; only the manual real-world pass (Phase 17) needs a key.

/**
 * Crude label → answer-type guesses. Only good enough to make mock output look
 * plausible in the review panel; the real classification is the model's job.
 * Order matters — the first match wins, so long/specific patterns come first.
 */
const TYPE_PATTERNS: [type: string, pattern: RegExp][] = [
  ['cover-letter', /cover\s*letter/i],
  ['motivation', /why (do you |are you )?(want|apply|join|us|this)|motivat|interest(ed)? in/i],
  ['work-authorization', /sponsor|visa|work authori[sz]|legally (able|eligible)|right to work/i],
  ['availability', /start date|availab|notice period|earliest/i],
  ['salary', /salary|compensation|expected pay|rate/i],
  ['strengths', /strength|greatest (achievement|accomplishment)|proud/i],
  ['weakness', /weakness|area (for|of) improvement/i],
  ['url', /linked\s*in|github|portfolio|website|\burl\b/i],
  ['email', /e-?mail/i],
  ['phone', /phone|mobile|telephone/i],
  ['location', /city|country|address|location|postal|zip/i],
  ['name', /\bname\b/i],
];

/** Best-effort local answer type for a field label. Returns `other` if unsure. */
export function classifyLabelLocally(label: string): string {
  for (const [type, pattern] of TYPE_PATTERNS) {
    if (pattern.test(label)) return type;
  }
  return 'other';
}

export interface MockGeneratorOptions {
  /**
   * Make `generate` reject with this message, so the orchestration and UI error
   * paths can be exercised without a provider that can be made to fail.
   */
  failWith?: string;
}

/** A `Generator` that fabricates one canned answer per field. No network call. */
export class MockGenerator implements Generator {
  private readonly options: MockGeneratorOptions;

  constructor(options: MockGeneratorOptions = {}) {
    this.options = options;
  }

  generate(prompt: BuiltPrompt): Promise<GeneratedAnswer[]> {
    if (this.options.failWith !== undefined) {
      return Promise.reject(new GeneratorError('response', this.options.failWith));
    }
    return Promise.resolve(prompt.fields.map(mockAnswerFor));
  }
}

function mockAnswerFor(field: PromptFieldRef): GeneratedAnswer {
  const label = field.resolvedLabel.trim();
  if (label.length === 0) {
    // Mirrors the real thing: an unlabeled field is exactly where a model is
    // least sure, so the panel should show it as low confidence.
    return {
      tempId: field.tempId,
      classifiedType: 'unknown',
      confidence: 'low',
      draftAnswer: `Mock draft for unlabeled ${field.elementType} (${field.tempId}).`,
    };
  }
  return {
    tempId: field.tempId,
    classifiedType: classifyLabelLocally(label),
    confidence: 'high',
    draftAnswer: `Mock draft for "${label}" (${field.elementType}).`,
  };
}
