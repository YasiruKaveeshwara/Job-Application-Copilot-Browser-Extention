import type { Settings } from './types';
import { getSettings } from './storage';
import { GeneratorError } from './generator/types';

// The Gemini transport: URL, auth, HTTP and response-shape handling, in one
// place. Everything vendor-specific about *talking to* Gemini lives here; what to
// ask it for lives with each feature (lib/generator, lib/extractor).
//
// Extracted from GeminiGenerator when CV import needed the same round trip. Both
// callers send a `generateContent` body and want the model's text back or a typed
// failure, so there is exactly one copy of the auth header, the error envelope
// parsing, and the truncated/blocked/empty checks — the parts where a second
// implementation would silently drift from the first.
//
// Verified against ai.google.dev on 2026-08-20 (generateContent, request shape,
// error envelope) and 2026-08-21 (inline document input, see lib/extractor).
//
// Errors are `GeneratorError`, which keeps its name: it is the one error type the
// provider path throws, its four kinds (config/network/http/response) describe
// transport outcomes rather than anything generator-specific, and the UI already
// knows how to word each kind.

export const GEMINI_MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Full endpoint for one model. The model ID travels in the path, not the body. */
export function generateContentUrl(modelId: string): string {
  return `${GEMINI_MODELS_BASE}/${encodeURIComponent(modelId)}:generateContent`;
}

interface GeminiPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
}

interface GeminiErrorEnvelope {
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Settings for a request, refusing to send one that cannot succeed.
 *
 * A missing key is a `config` failure precisely so the caller can tell "you have
 * not set this up" apart from "the provider rejected it", and say so.
 */
export async function loadGeminiSettings(): Promise<Settings> {
  const settings = await getSettings();
  if (settings.apiKey.trim().length === 0) {
    throw new GeneratorError(
      'config',
      'No Gemini API key saved. Add one on the extension options page.',
    );
  }
  if (settings.modelId.trim().length === 0) {
    throw new GeneratorError('config', 'No Gemini model selected in settings.');
  }
  return settings;
}

/**
 * Send one `generateContent` request and return the model's text.
 *
 * Throws `GeneratorError` for every failure mode, so a caller only ever needs one
 * catch: no key (`config`), request never landed (`network`), non-2xx (`http`,
 * carrying the status), or a reply that arrived unusable (`response` — blocked,
 * truncated, no candidates, empty, or not JSON).
 */
export async function callGemini(body: unknown): Promise<string> {
  const settings = await loadGeminiSettings();

  let response: Response;
  try {
    response = await fetch(generateContentUrl(settings.modelId), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // In a header, never the query string, so the key stays out of URLs,
        // logs, and anything that reports a failing request URL.
        'x-goog-api-key': settings.apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new GeneratorError('network', `Could not reach the Gemini API: ${messageOf(cause)}`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new GeneratorError(
      'http',
      `Gemini API returned ${response.status} — ${await readApiErrorMessage(response)}`,
      { status: response.status },
    );
  }

  let payload: GeminiResponse;
  try {
    payload = (await response.json()) as GeminiResponse;
  } catch (cause) {
    throw new GeneratorError('response', 'Gemini API response body was not JSON', { cause });
  }

  return extractText(payload);
}

/**
 * Pull the text out of a successful response, failing loudly on every shape that
 * would otherwise reach a parser as confusing garbage.
 */
function extractText(payload: GeminiResponse): string {
  const blockReason = payload.promptFeedback?.blockReason;
  if (blockReason !== undefined) {
    throw new GeneratorError('response', `Gemini blocked the prompt (${blockReason}).`);
  }

  const candidate = payload.candidates?.[0];
  if (candidate === undefined) {
    throw new GeneratorError('response', 'Gemini returned no candidates.');
  }

  const finishReason = candidate.finishReason;
  if (finishReason !== undefined && finishReason !== 'STOP') {
    // MAX_TOKENS in particular yields truncated JSON; naming the reason is far
    // more actionable than "unexpected end of JSON input".
    throw new GeneratorError('response', `Gemini stopped early (finishReason: ${finishReason}).`);
  }

  const text = (candidate.content?.parts ?? []).map((part) => part.text ?? '').join('');
  if (text.trim().length === 0) {
    throw new GeneratorError('response', 'Gemini returned an empty answer.');
  }
  return text;
}

/** Google's error envelope if present, else the raw body, capped for display. */
async function readApiErrorMessage(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return response.statusText || 'no response body';
  }

  try {
    const parsed = JSON.parse(body) as GeminiErrorEnvelope;
    const message = parsed.error?.message;
    if (message !== undefined && message.length > 0) {
      const status = parsed.error?.status;
      return status !== undefined ? `${status}: ${message}` : message;
    }
  } catch {
    // Not JSON (an HTML error page, a proxy response); fall through to the body.
  }
  return body.slice(0, 500) || response.statusText || 'no response body';
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
