import type { GeneratedAnswer, Settings } from '../types';
import { getSettings } from '../storage';
import { SchemaValidationError, validateGeneratedAnswers } from '../schema-validator';
import type { BuiltPrompt, Generator } from './types';
import { GeneratorError } from './types';

// Google Gemini, called directly from the background service worker with a
// bring-your-own key.
//
// Substituted for the build guide's Anthropic generator at the user's request.
// Verified against ai.google.dev on 2026-08-20:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   headers: content-type: application/json, x-goog-api-key: <key>
//   body:    { systemInstruction, contents[], generationConfig }
//   ok:      { candidates: [{ content: { parts: [{ text }] }, finishReason }], … }
//   error:   { error: { code, message, status } }
//
// Two differences from the Anthropic shape the guide describes, both structural
// rather than optional:
//   * The model ID is a path segment, not a body field, so the request assertion
//     is on the URL rather than the body.
//   * There is no `anthropic-dangerous-direct-browser-access` equivalent. Google
//     needs no client-side opt-in header; the cross-origin call works because MV3
//     grants the service worker the host permissions declared in the manifest
//     (`<all_urls>` covers this endpoint).

export const GEMINI_MODELS_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Full endpoint for one model. The model ID travels in the path, not the body. */
export function generateContentUrl(modelId: string): string {
  return `${GEMINI_MODELS_BASE}/${encodeURIComponent(modelId)}:generateContent`;
}

/**
 * `GeneratedAnswer[]` in Gemini's responseSchema dialect (an OpenAPI subset with
 * upper-case type names). Sent with every request so the provider constrains its
 * own output; `validateGeneratedAnswers` is then a safety net rather than the
 * only line of defence.
 */
export const ANSWER_ARRAY_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      tempId: { type: 'STRING' },
      classifiedType: { type: 'STRING' },
      confidence: { type: 'STRING', enum: ['high', 'low'] },
      draftAnswer: { type: 'STRING' },
    },
    required: ['tempId', 'classifiedType', 'confidence', 'draftAnswer'],
    propertyOrdering: ['tempId', 'classifiedType', 'confidence', 'draftAnswer'],
  },
};

/** Enough for a page of drafted long-form answers without truncating mid-JSON. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

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

export interface GeminiGeneratorOptions {
  maxOutputTokens?: number;
}

export class GeminiGenerator implements Generator {
  private readonly maxOutputTokens: number;

  constructor(options: GeminiGeneratorOptions = {}) {
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async generate(prompt: BuiltPrompt): Promise<GeneratedAnswer[]> {
    const settings = await loadSettings();
    const response = await this.post(settings, prompt);

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

    const text = extractText(payload);
    try {
      return validateGeneratedAnswers(text);
    } catch (cause) {
      // Re-wrapped so callers only ever need to catch GeneratorError from a
      // generator, whatever layer the failure actually came from.
      const detail = cause instanceof SchemaValidationError ? cause.message : messageOf(cause);
      throw new GeneratorError(
        'response',
        `Gemini response did not match the answer schema. ${detail}`,
        { cause },
      );
    }
  }
  private async post(settings: Settings, prompt: BuiltPrompt): Promise<Response> {
    try {
      return await fetch(generateContentUrl(settings.modelId), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // In a header, never the query string, so the key stays out of URLs,
          // logs, and anything that reports a failing request URL.
          'x-goog-api-key': settings.apiKey,
        },
        body: JSON.stringify(this.buildRequestBody(prompt)),
      });
    } catch (cause) {
      throw new GeneratorError('network', `Could not reach the Gemini API: ${messageOf(cause)}`, {
        cause,
      });
    }
  }

  private buildRequestBody(prompt: BuiltPrompt): unknown {
    return {
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANSWER_ARRAY_SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
        // No temperature/topP/topK on purpose: Gemini 3 models are tuned around
        // their default sampling settings and Google advises against overriding
        // them.
      },
    };
  }
}

async function loadSettings(): Promise<Settings> {
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
 * Pull the answer text out of a successful response, failing loudly on every
 * shape that would otherwise reach the validator as confusing garbage.
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

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
