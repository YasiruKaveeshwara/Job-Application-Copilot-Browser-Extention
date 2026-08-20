import type { GeneratedAnswer } from '../types';

// The seam that keeps every phase after this one testable without API spend:
// "produce answers for these fields" is an interface, "call this specific
// provider" is one implementation of it.

/** One field the prompt asks about. Enough for a generator to key answers back. */
export interface PromptFieldRef {
  tempId: string;
  resolvedLabel: string;
  elementType: string;
}

/**
 * A provider-agnostic prompt, produced by `buildPrompt` (Phase 11).
 *
 * Nothing in here is specific to any vendor's request format — that mapping is
 * each generator's job. This is what makes swapping generators a one-line change
 * at the call site.
 */
export interface BuiltPrompt {
  /** Instructions and output contract. Sent as the system instruction. */
  system: string;
  /** The batched request body: fields, job context, retrieved fragments, style. */
  user: string;
  /** The fields covered by `user`, in the order they appear. */
  fields: PromptFieldRef[];
}

export interface Generator {
  generate(prompt: BuiltPrompt): Promise<GeneratedAnswer[]>;
}

/**
 * Why generation failed, for the orchestration layer to branch on:
 * - `config`   — nothing was sent; the user needs to fix a setting (e.g. no key)
 * - `network`  — the request never got a response
 * - `http`     — the provider answered with a non-2xx status (see `status`)
 * - `response` — a response arrived but was unusable (blocked, truncated,
 *                not JSON, or not matching the answer schema)
 */
export type GeneratorErrorKind = 'config' | 'network' | 'http' | 'response';

/** The one error type generators throw. Never swallowed, never a sentinel value. */
export class GeneratorError extends Error {
  readonly kind: GeneratorErrorKind;
  /** HTTP status, present only when `kind` is `'http'`. */
  readonly status: number | undefined;

  constructor(
    kind: GeneratorErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'GeneratorError';
    this.kind = kind;
    this.status = options.status;
  }
}
