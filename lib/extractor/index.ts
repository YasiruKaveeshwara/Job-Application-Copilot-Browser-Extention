import { GeminiExtractor } from './gemini-extractor';
import { MockExtractor } from './mock-extractor';
import type { ProfileExtractor } from './types';

// Where the one call site picks an extractor, mirroring lib/generator/index.ts.
//
// Import from this file only where a real provider is wanted — the background
// service worker. It pulls in lib/gemini-client, and the packaging test asserts
// the Gemini endpoint appears in `background.js` and nowhere else; the options
// page therefore imports ./types and ./merge directly, never this index.

export type { ProfileExtractor } from './types';
export { MAX_PDF_BYTES, MAX_PDF_LABEL, base64ByteLength, checkPdfSize } from './types';
export { GeminiExtractor, EXTRACTION_INSTRUCTION } from './gemini-extractor';
export { MockExtractor, MOCK_EXTRACTED_CV } from './mock-extractor';
export { ExtractionSchemaError, validateExtractedProfile } from './schema';

/**
 * True when this build wired in {@link MockExtractor}.
 *
 * Shares `VITE_USE_MOCK_GENERATOR` with the answer generator rather than adding a
 * second flag: both mean "this build talks to no provider", and one switch cannot
 * be set half-on. See `usingMockGenerator` in lib/generator/index.ts for why the
 * env key is spelled out as a literal member access here and repeated inside
 * {@link getExtractor} — Vite only folds the comparison away, leaving the mock out
 * of a release build, if it can see the literal at each site.
 */
export function usingMockExtractor(): boolean {
  return import.meta.env.VITE_USE_MOCK_GENERATOR === 'true';
}

/** The extractor for this build. Cheap to construct; not cached deliberately. */
export function getExtractor(): ProfileExtractor {
  // Repeats the condition rather than calling it: the minifier folds a literal
  // comparison but will not inline what a function call returns, and this is the
  // branch that has to disappear from the build.
  return import.meta.env.VITE_USE_MOCK_GENERATOR === 'true'
    ? new MockExtractor()
    : new GeminiExtractor();
}
