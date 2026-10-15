import type { Settings, ModelChoice } from './types';
import { getSettings, getAvailableModels } from './storage';
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

export const GEMINI_REQUEST_TIMEOUT_MS = 30_000;

const MAX_MODEL_ATTEMPTS = 3;

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
 * 2. Other models discovered using the user's API key
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

  return candidates;
}

/**
 * Send one `generateContent` request and return the model's text.
 *
 * If the current model fails with quota exceeded (429), model not found/unsupported (404/400),
 * a network error, or a timeout, automatically tries up to two more models
 * discovered using the user's API key. Every attempt is bounded by a timeout.
 * A fallback is used for this request only; it never changes the user's selected
 * model preference.
 */
export async function callGemini(body: unknown): Promise<string> {
  const settings = await loadGeminiSettings();
  const candidateModels = (await getModelCandidates(settings.modelId)).slice(0, MAX_MODEL_ATTEMPTS);

  let lastError: GeneratorError | undefined;

  for (let i = 0; i < candidateModels.length; i++) {
    const modelId = candidateModels[i]!;
    try {
      return await requestGeminiModel(modelId, settings.apiKey, body);
    } catch (caught) {
      lastError =
        caught instanceof GeneratorError
          ? caught
          : new GeneratorError('network', `Could not reach the Gemini API: ${messageOf(caught)}`, {
              cause: caught,
            });

      // An invalid key is independent of the model. Other transport and HTTP
      // failures may be specific to this model or to its PDF/schema support.
      if (lastError.kind === 'http' && lastError.status === 401) {
        throw lastError;
      }

      const canTryFallback =
        lastError.kind === 'network' ||
        lastError.kind === 'http' ||
        lastError.message === 'Gemini API response body was not JSON';
      if (!canTryFallback || i === candidateModels.length - 1) {
        throw lastError;
      }

      const nextModel = candidateModels[i + 1];
      console.warn(
        `[job-copilot] Model "${modelId}" failed (${lastError.message}). Automatically trying "${nextModel}"...`,
      );
    }
  }

  throw lastError ?? new GeneratorError('response', 'All available Gemini models failed.');
}

async function requestGeminiModel(modelId: string, apiKey: string, body: unknown): Promise<string> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new GeneratorError('network', 'Gemini request timed out.'));
    }, GEMINI_REQUEST_TIMEOUT_MS);
  });

  const request = async (): Promise<string> => {
    const response = await fetch(generateContentUrl(modelId), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // In a header, never the query string, so the key stays out of URLs,
        // logs, and anything that reports a failing request URL.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorMsg = await readApiErrorMessage(response);
      throw new GeneratorError('http', `Gemini API returned ${response.status} — ${errorMsg}`, {
        status: response.status,
      });
    }

    let payload: GeminiResponse;
    try {
      payload = (await response.json()) as GeminiResponse;
    } catch (cause) {
      throw new GeneratorError('response', 'Gemini API response body was not JSON', { cause });
    }

    return extractText(payload);
  };

  try {
    return await Promise.race([request(), timeout]);
  } catch (cause) {
    if (cause instanceof GeneratorError) throw cause;
    if (timedOut) {
      throw new GeneratorError('network', 'Gemini request timed out.', { cause });
    }
    throw new GeneratorError('network', `Could not reach the Gemini API: ${messageOf(cause)}`, {
      cause,
    });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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

  const toChoice = (m: RawGeminiModel): ModelChoice => {
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
  };
  const capabilityRank = (model: RawGeminiModel): number => {
    const description = `${model.displayName ?? ''} ${model.name}`.toLowerCase();
    if (/\b(ultra|pro|reasoning|thinking)\b/.test(description)) return 3;
    if (/\b(flash|lite|nano)\b/.test(description)) return 1;
    return 2;
  };
  const modelVersion = (model: RawGeminiModel): number[] => {
    const version =
      model.version?.match(/\d+(?:\.\d+)+/)?.[0] ??
      model.name.match(/\d+(?:\.\d+)+/)?.[0] ??
      model.version ??
      '';
    return version.split('.').map((part) => Number(part) || 0);
  };
  const compareVersions = (left: number[], right: number[]): number => {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (right[index] ?? 0) - (left[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };

  const ranked = [...generationModels].sort((a, b) => {
    const familyDifference = capabilityRank(b) - capabilityRank(a);
    if (familyDifference !== 0) return familyDifference;

    const versionDifference = compareVersions(modelVersion(a), modelVersion(b));
    if (versionDifference !== 0) return versionDifference;

    const outputDifference = (b.outputTokenLimit ?? 0) - (a.outputTokenLimit ?? 0);
    if (outputDifference !== 0) return outputDifference;

    const inputDifference = (b.inputTokenLimit ?? 0) - (a.inputTokenLimit ?? 0);
    if (inputDifference !== 0) return inputDifference;

    return a.name.localeCompare(b.name);
  });

  return ranked.map(toChoice);
}
