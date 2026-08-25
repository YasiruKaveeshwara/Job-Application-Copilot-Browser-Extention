import type { GeneratedAnswer } from '../types';
import { callGemini } from '../gemini-client';
import { SchemaValidationError, validateGeneratedAnswers } from '../schema-validator';
import type { BuiltPrompt, Generator } from './types';
import { GeneratorError } from './types';

// Google Gemini, called directly from the background service worker with a
// bring-your-own key.
//
// The URL, auth header, and HTTP/response handling live in lib/gemini-client.ts,
// shared with the CV extractor; this file is only "what to ask for and what to do
// with the answer".
//
// Key implementation details:
//   * The model ID is a path segment in the URL, not a body field, so request
//     assertions check the URL rather than the body.
//   * No special client-side opt-in header is needed. The cross-origin call works
//     because MV3 grants the service worker the host permissions declared in the
//     manifest (`<all_urls>` covers this endpoint).

export { GEMINI_MODELS_BASE, generateContentUrl } from '../gemini-client';

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

export interface GeminiGeneratorOptions {
  maxOutputTokens?: number;
}

export class GeminiGenerator implements Generator {
  private readonly maxOutputTokens: number;

  constructor(options: GeminiGeneratorOptions = {}) {
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  }

  async generate(prompt: BuiltPrompt): Promise<GeneratedAnswer[]> {
    const text = await callGemini(this.buildRequestBody(prompt));
    try {
      return validateGeneratedAnswers(text);
    } catch (cause) {
      // Re-wrapped so callers only ever need to catch GeneratorError from a
      // generator, whatever layer the failure actually came from.
      const detail = cause instanceof SchemaValidationError ? cause.message : String(cause);
      throw new GeneratorError(
        'response',
        `Gemini response did not match the answer schema. ${detail}`,
        { cause },
      );
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
