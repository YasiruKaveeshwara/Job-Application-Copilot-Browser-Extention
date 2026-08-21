import type { GeneratedAnswer } from './types';

// The boundary between "whatever the model said" and typed data the rest of the
// extension is allowed to see. Nothing downstream of here handles `unknown`.
//
// Listed under Phase 11 in the build guide, but Phase 9's generator is specified
// to parse its response "using the Phase 11 schema validator", so it lands here.

/** Thrown when a model response does not match `GeneratedAnswer[]`. */
export class SchemaValidationError extends Error {
  /** One entry per problem found, so a caller can surface all of them at once. */
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}: ${issues.join('; ')}` : message);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

const CONFIDENCE_VALUES = new Set(['high', 'low']);

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/**
 * Unwrap a ```json … ``` fence, which models add even when told not to.
 *
 * Exported for the CV extractor's validator (lib/extractor/schema.ts), which
 * meets the same habit on a different response shape.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * Parse and validate a raw model response into `GeneratedAnswer[]`.
 *
 * Accepts either the raw response text or an already-parsed value. Throws
 * `SchemaValidationError` on any mismatch rather than passing partial data
 * downstream. Unrecognized keys on an answer are dropped, not rejected — the
 * object is rebuilt from known fields, so model chattiness inside the JSON can't
 * leak into stored state.
 *
 * Prose around the JSON is a hard failure by design: fishing an array out of
 * surrounding text can silently drop answers, and a loud error is recoverable
 * (retry, or show the user an error) while silent truncation is not.
 */
export function validateGeneratedAnswers(raw: unknown): GeneratedAnswer[] {
  let value: unknown = raw;

  if (typeof raw === 'string') {
    const text = stripCodeFence(raw);
    if (text.length === 0) {
      throw new SchemaValidationError('Model returned an empty response');
    }
    try {
      value = JSON.parse(text);
    } catch {
      throw new SchemaValidationError('Model response was not valid JSON');
    }
  }

  if (!Array.isArray(value)) {
    throw new SchemaValidationError('Expected a JSON array of answers', [
      `got ${describeType(value)}`,
    ]);
  }

  const issues: string[] = [];
  const answers: GeneratedAnswer[] = [];

  value.forEach((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      issues.push(`[${index}] expected an object, got ${describeType(item)}`);
      return;
    }

    const record = item as Record<string, unknown>;
    const { tempId, classifiedType, confidence, draftAnswer } = record;
    const before = issues.length;

    if (typeof tempId !== 'string' || tempId.trim().length === 0) {
      issues.push(`[${index}] tempId must be a non-empty string`);
    }
    if (typeof classifiedType !== 'string' || classifiedType.trim().length === 0) {
      issues.push(`[${index}] classifiedType must be a non-empty string`);
    }
    if (typeof confidence !== 'string' || !CONFIDENCE_VALUES.has(confidence)) {
      issues.push(`[${index}] confidence must be "high" or "low"`);
    }
    if (typeof draftAnswer !== 'string') {
      issues.push(`[${index}] draftAnswer must be a string`);
    }
    if (issues.length > before) return;

    answers.push({
      tempId: tempId as string,
      classifiedType: classifiedType as string,
      confidence: confidence as GeneratedAnswer['confidence'],
      draftAnswer: draftAnswer as string,
    });
  });

  if (issues.length > 0) {
    throw new SchemaValidationError('Malformed generated answers', issues);
  }
  return answers;
}
