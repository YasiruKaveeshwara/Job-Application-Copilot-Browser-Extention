import { GeminiGenerator } from './gemini-generator';
import { MockGenerator } from './mock-generator';
import type { Generator } from './types';

// Where the one call site picks a generator. Phase 9's acceptance criterion was
// that swapping implementations costs zero call-site changes; this is the seam
// that makes that true.

export type { BuiltPrompt, Generator, GeneratorErrorKind, PromptFieldRef } from './types';
export { GeneratorError } from './types';
export { GeminiGenerator } from './gemini-generator';
export { MockGenerator } from './mock-generator';

/**
 * Build-time flag that swaps in {@link MockGenerator}.
 *
 * Set `VITE_USE_MOCK_GENERATOR=true` (in `.env.local`, which is git-ignored, or
 * inline in the dev command) to exercise the whole scan → generate → review
 * round trip with no API key and no spend. Phase 12's manual verification of the
 * review panel runs this way.
 */
export const MOCK_GENERATOR_FLAG = 'VITE_USE_MOCK_GENERATOR';

function readFlag(name: string): boolean {
  // Read through a record: `ImportMetaEnv`'s index signature is typed as
  // `string | boolean | undefined` and does not know about project-specific keys.
  const env = import.meta.env as unknown as Record<string, unknown>;
  return env[name] === 'true' || env[name] === true;
}

/** True when the mock generator is active, so the UI can say so. */
export function usingMockGenerator(): boolean {
  return readFlag(MOCK_GENERATOR_FLAG);
}

/** The generator for this build. Cheap to construct; not cached deliberately. */
export function getGenerator(): Generator {
  return usingMockGenerator() ? new MockGenerator() : new GeminiGenerator();
}
