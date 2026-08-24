import type { Settings, ModelChoice } from './types';
import {
  getSettings,
  saveSettings,
  DEFAULT_MODEL_ID,
  getAvailableModels,
  DEFAULT_AVAILABLE_MODELS,
} from './storage';
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
 * Build the ordered list of models to try:
 * 1. Current selected model in settings
 * 2. Stored available models (excluding current)
 * 3. Fallback default models (excluding already listed)
 */
export async function getModelCandidates(preferredModelId: string): Promise<string[]> {
  const candidates: string[] = [];
  const add = (id: string | undefined) => {
    if (id && id.trim().length > 0 && !candidates.includes(id.trim())) {
      candidates.push(id.trim());
    }
  };

  add(preferredModelId);

  try {
    const available = await getAvailableModels();
    for (const choice of available) {
      add(choice.id);
    }
  } catch {
    // Best effort if storage read fails
  }

  for (const choice of DEFAULT_AVAILABLE_MODELS) {
    add(choice.id);
  }

  return candidates;
}

/**
 * Send one `generateContent` request and return the model's text.
 *
 * If the current model fails with quota exceeded (429), model not found/unsupported (404/400),
 * or server error (5xx), automatically fails over to the next best available model.
 * If a fallback model succeeds, automatically updates the active model setting.
 */
export async function callGemini(body: unknown): Promise<string> {
  const settings = await loadGeminiSettings();
  const candidateModels = await getModelCandidates(settings.modelId);

  let lastError: GeneratorError | undefined;

  for (let i = 0; i < candidateModels.length; i++) {
    const modelId = candidateModels[i]!;
    let response: Response;

    try {
      response = await fetch(generateContentUrl(modelId), {
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
      lastError = new GeneratorError(
        'network',
        `Could not reach the Gemini API: ${messageOf(cause)}`,
        {
          cause,
        },
      );
      // If there are more models to try, continue; otherwise throw
      if (i < candidateModels.length - 1) {
        console.warn(
          `[job-copilot] Network error on model "${modelId}". Trying next fallback model...`,
        );
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const errorMsg = await readApiErrorMessage(response);
      lastError = new GeneratorError(
        'http',
        `Gemini API returned ${response.status} — ${errorMsg}`,
        { status: response.status },
      );

      // HTTP 401 indicates the API key itself is invalid. Trying other models will also 401.
      if (response.status === 401) {
        throw lastError;
      }

      // If status is 429 (quota/rate limit), 404 (model not found), 400 (bad model),
      // or 5xx (overloaded), try fallback model if available
      if (i < candidateModels.length - 1) {
        const nextModel = candidateModels[i + 1];
        console.warn(
          `[job-copilot] Model "${modelId}" failed with HTTP ${response.status} (${errorMsg}). Automatically failing over to "${nextModel}"...`,
        );
        continue;
      }

      throw lastError;
    }

    let payload: GeminiResponse;
    try {
      payload = (await response.json()) as GeminiResponse;
    } catch (cause) {
      lastError = new GeneratorError('response', 'Gemini API response body was not JSON', {
        cause,
      });
      if (i < candidateModels.length - 1) {
        continue;
      }
      throw lastError;
    }

    // If candidate model worked and was a fallback, update active setting
    if (modelId !== settings.modelId) {
      console.info(
        `[job-copilot] Fallback model "${modelId}" succeeded. Updating active model setting.`,
      );
      try {
        await saveSettings({ ...settings, modelId });
      } catch {
        // Non-fatal if setting save fails
      }
    }

    return extractText(payload);
  }

  throw lastError ?? new GeneratorError('response', 'All available Gemini models failed.');
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

interface RawGeminiModel {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

interface RawGeminiModelsResponse {
  models?: RawGeminiModel[];
}

/**
 * Fetch the list of real available models from the Gemini API using the given API key
 * (or the stored key). Filters to models that support generateContent.
 */
export async function fetchGeminiModels(explicitApiKey?: string): Promise<ModelChoice[]> {
  let apiKey = explicitApiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    const settings = await getSettings();
    apiKey = settings.apiKey;
  }

  if (!apiKey || apiKey.trim().length === 0) {
    throw new GeneratorError(
      'config',
      'No Gemini API key saved. Add one on the extension options page.',
    );
  }

  let response: Response;
  try {
    response = await fetch(GEMINI_MODELS_BASE, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
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

  let payload: RawGeminiModelsResponse;
  try {
    payload = (await response.json()) as RawGeminiModelsResponse;
  } catch (cause) {
    throw new GeneratorError('response', 'Gemini API response body was not JSON', { cause });
  }

  const rawModels = payload.models ?? [];
  const generationModels = rawModels.filter(
    (m) =>
      Array.isArray(m.supportedGenerationMethods) &&
      m.supportedGenerationMethods.includes('generateContent'),
  );

  if (generationModels.length === 0) {
    return [];
  }

  const choices: ModelChoice[] = generationModels.map((m) => {
    const id = m.name.replace(/^models\//, '');
    const displayName = m.displayName?.trim();
    let label = displayName && displayName.length > 0 ? `${displayName} (${id})` : id;
    if (displayName && displayName.toLowerCase() === id.toLowerCase()) {
      label = displayName;
    }
    return {
      id,
      label,
      description: m.description,
    };
  });

  return choices.sort((a, b) => {
    const aId = a.id.toLowerCase();
    const bId = b.id.toLowerCase();

    // Default model at top
    if (a.id === DEFAULT_MODEL_ID) return -1;
    if (b.id === DEFAULT_MODEL_ID) return 1;

    // Flash models before pro models
    const aIsFlash = aId.includes('flash');
    const bIsFlash = bId.includes('flash');
    if (aIsFlash && !bIsFlash) return -1;
    if (!aIsFlash && bIsFlash) return 1;

    return aId.localeCompare(bId);
  });
}
