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

/**
 * True when this build wired in the mock generator.
 *
 * The env key is spelled out as a literal member access on purpose, here and in
 * {@link getGenerator}, and must stay that way. Vite substitutes
 * `import.meta.env.SOME_KEY` at build time, so a plain `npm run build` turns the
 * comparison into a constant and the mock generator leaves the bundle entirely.
 * Reading the same key dynamically (`env[MOCK_GENERATOR_FLAG]`) type-checks and
 * behaves identically at runtime, but defeats the substitution: it ships the mock
 * in every build and leaves a dev-only code path one environment variable away
 * from being live in a release. `test/e2e/packaging.spec.ts` asserts the built
 * output is free of it.
 *
 * The literal therefore duplicates {@link MOCK_GENERATOR_FLAG}, which is what
 * lets tests flip the flag with `vi.stubEnv`. The unit test that does so is what
 * keeps the two spellings honest — if they drift, it fails.
 */
export function usingMockGenerator(): boolean {
  return import.meta.env.VITE_USE_MOCK_GENERATOR === 'true';
}

/** The generator for this build. Cheap to construct; not cached deliberately. */
export function getGenerator(): Generator {
  // Repeats the condition above rather than calling it: the minifier folds a
  // literal comparison, but does not inline a function call to fold what it
  // returns — and this is the branch that has to disappear from the build.
  return import.meta.env.VITE_USE_MOCK_GENERATOR === 'true'
    ? new MockGenerator()
    : new GeminiGenerator();
}
