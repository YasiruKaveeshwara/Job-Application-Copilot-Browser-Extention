import type { ExtractedProfileData } from '../types';

// The seam between "read a CV" and "which provider read it", mirroring
// lib/generator/types.ts: one interface, so the options page never knows whether
// a real model or the canned mock answered.
//
// There is deliberately no error type of its own here. A CV import fails for the
// same reasons a draft does — no key, no network, a refused request, an unusable
// reply — and those are already `GeneratorError`'s four kinds, thrown by
// lib/gemini-client.ts for both callers. A parallel hierarchy would only give the
// UI a second set of identical branches to word.

export interface ProfileExtractor {
  /**
   * Read what a CV states, as structured data.
   *
   * @param pdfBase64 the PDF's bytes, base64-encoded, with no data-URL prefix.
   * @throws Error — `GeneratorError` for transport and response failures.
   */
  extract(pdfBase64: string): Promise<ExtractedProfileData>;
}

/**
 * Largest PDF accepted, well under what the provider allows.
 *
 * Gemini takes up to 50 MB of inline document data, but that is not the binding
 * limit here: the base64 travels from the options page to the background worker
 * as a runtime message first, and base64 inflates by a third on the way. 8 MB is
 * far more than any text CV — a file above it is a scan of one, which extracts
 * poorly anyway — so the cap costs nothing real and turns a vague messaging
 * failure into a sentence the user can act on.
 */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

/** How the cap is worded in the UI, so the number is written down once. */
export const MAX_PDF_LABEL = '8 MB';

/** Byte length of base64-encoded data, without decoding it. */
export function base64ByteLength(base64: string): number {
  const compact = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

/**
 * Complaint about a file, or `undefined` if it is fine to send.
 *
 * Used twice on purpose: the options page checks the chosen file before spending
 * time encoding it, and the extractor checks the encoded payload before spending
 * a request on it.
 */
export function checkPdfSize(bytes: number): string | undefined {
  if (bytes === 0) return 'That file is empty.';
  if (bytes > MAX_PDF_BYTES) {
    return `That PDF is ${formatBytes(bytes)}. The limit is ${MAX_PDF_LABEL} — export a text-based CV rather than a scan, or compress it.`;
  }
  return undefined;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}
