import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveSettings, getSettings, saveAvailableModels } from '../../lib/storage';
import {
  GeminiGenerator,
  GEMINI_MODELS_BASE,
  generateContentUrl,
} from '../../lib/generator/gemini-generator';
import { fetchGeminiModels } from '../../lib/gemini-client';
import { GeneratorError } from '../../lib/generator/types';
import type { BuiltPrompt } from '../../lib/generator/types';
import type { GeneratedAnswer } from '../../lib/types';

// Every test here runs against a stubbed global fetch and asserts on that stub,
// so a real network call is impossible: an unstubbed request would fail the
// call-count assertion rather than quietly hitting Google.

const API_KEY = 'test-api-key-value';
const MODEL_ID = 'gemini-test-model';
const FALLBACK_MODEL_ID = 'gemini-test-fallback';

const prompt: BuiltPrompt = {
  system: 'You draft job application answers. Return JSON only.',
  user: 'Field f0 — label: "Cover Letter" (textarea)',
  fields: [{ tempId: 'f0', resolvedLabel: 'Cover Letter', elementType: 'textarea' }],
};

const answers: GeneratedAnswer[] = [
  { tempId: 'f0', classifiedType: 'cover-letter', confidence: 'high', draftAnswer: 'Dear team,' },
];

function geminiOk(text: string, finishReason: string | undefined = 'STOP'): Response {
  const payload = {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
    modelVersion: MODEL_ID,
  };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as unknown as Response;
}

function geminiRaw(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as unknown as Response;
}

function httpError(status: number, body: unknown): Response {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(JSON.parse(raw)),
    text: () => Promise.resolve(raw),
  } as unknown as Response;
}

/** The single fetch call the generator is expected to make. */
function callArgs(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe('GeminiGenerator request shape', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fakeBrowser.reset();
    fetchMock = vi.fn().mockResolvedValue(geminiOk(JSON.stringify(answers)));
    vi.stubGlobal('fetch', fetchMock);
    await saveSettings({ apiKey: API_KEY, modelId: MODEL_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the generateContent endpoint for the model ID from settings', async () => {
    await new GeminiGenerator().generate(prompt);
    const { url, init } = callArgs(fetchMock);

    expect(url).toBe(`${GEMINI_MODELS_BASE}/${MODEL_ID}:generateContent`);
    expect(url).toBe(generateContentUrl(MODEL_ID));
    expect(init.method).toBe('POST');
  });

  it('follows the model ID when the setting changes, with no code change', async () => {
    await saveSettings({ apiKey: API_KEY, modelId: FALLBACK_MODEL_ID });
    await new GeminiGenerator().generate(prompt);
    expect(callArgs(fetchMock).url).toContain(`${FALLBACK_MODEL_ID}:generateContent`);
  });

  it('sends the API key in the x-goog-api-key header and never in the URL', async () => {
    await new GeminiGenerator().generate(prompt);
    const { url, init } = callArgs(fetchMock);

    expect(headersOf(init)['x-goog-api-key']).toBe(API_KEY);
    // The key must stay out of URLs, logs and error reports.
    expect(url).not.toContain(API_KEY);
    expect(url).not.toContain('key=');
  });

  it('sends content-type application/json', async () => {
    await new GeminiGenerator().generate(prompt);
    expect(headersOf(callArgs(fetchMock).init)['content-type']).toBe('application/json');
  });

  it('sends the prompt as systemInstruction plus one user content part', async () => {
    await new GeminiGenerator().generate(prompt);
    const body = JSON.parse(callArgs(fetchMock).init.body as string);

    expect(body.systemInstruction.parts[0].text).toBe(prompt.system);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe(prompt.user);
  });

  it('constrains the response to the GeneratedAnswer[] schema', async () => {
    await new GeminiGenerator().generate(prompt);
    const body = JSON.parse(callArgs(fetchMock).init.body as string);
    const config = body.generationConfig;

    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseSchema.type).toBe('ARRAY');
    expect(config.responseSchema.items.required).toEqual([
      'tempId',
      'classifiedType',
      'confidence',
      'draftAnswer',
    ]);
    expect(config.responseSchema.items.properties.confidence.enum).toEqual(['high', 'low']);
    expect(config.maxOutputTokens).toBeGreaterThan(0);
  });

  it('does not override sampling parameters', async () => {
    await new GeminiGenerator().generate(prompt);
    const config = JSON.parse(callArgs(fetchMock).init.body as string).generationConfig;
    expect(config.temperature).toBeUndefined();
    expect(config.topP).toBeUndefined();
    expect(config.topK).toBeUndefined();
  });

  it('honours an overridden maxOutputTokens', async () => {
    await new GeminiGenerator({ maxOutputTokens: 256 }).generate(prompt);
    const config = JSON.parse(callArgs(fetchMock).init.body as string).generationConfig;
    expect(config.maxOutputTokens).toBe(256);
  });
});

describe('GeminiGenerator response handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fakeBrowser.reset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await saveSettings({ apiKey: API_KEY, modelId: MODEL_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a well-formed response into GeneratedAnswer[]', async () => {
    fetchMock.mockResolvedValue(geminiOk(JSON.stringify(answers)));
    await expect(new GeminiGenerator().generate(prompt)).resolves.toEqual(answers);
  });

  it('joins multiple text parts before parsing', async () => {
    const json = JSON.stringify(answers);
    const split = json.slice(0, 12);
    const rest = json.slice(12);
    fetchMock.mockResolvedValue(
      geminiRaw({
        candidates: [
          { content: { parts: [{ text: split }, { text: rest }] }, finishReason: 'STOP' },
        ],
      }),
    );
    await expect(new GeminiGenerator().generate(prompt)).resolves.toEqual(answers);
  });

  it('throws an http-kind error carrying the status and the API message', async () => {
    fetchMock.mockResolvedValue(
      httpError(429, {
        error: { code: 429, message: 'Quota exceeded for requests.', status: 'RESOURCE_EXHAUSTED' },
      }),
    );

    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(429);
    expect(error.message).toContain('RESOURCE_EXHAUSTED');
    expect(error.message).toContain('Quota exceeded');
  });

  it('surfaces a non-JSON error body rather than crashing on it', async () => {
    fetchMock.mockResolvedValue(httpError(502, '<html>Bad Gateway</html>'));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(502);
    expect(error.message).toContain('Bad Gateway');
  });

  it('throws a network-kind error when the request never lands', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('network');
    expect(error.message).toContain('Failed to fetch');
  });

  it('throws a response-kind error when the model text is not valid JSON', async () => {
    fetchMock.mockResolvedValue(geminiOk('Sure, here are some answers!'));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('answer schema');
  });

  it('throws a response-kind error when an answer violates the schema', async () => {
    fetchMock.mockResolvedValue(
      geminiOk(JSON.stringify([{ ...answers[0]!, confidence: 'medium' }])),
    );
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('confidence');
  });

  it('throws a response-kind error when the prompt was blocked', async () => {
    fetchMock.mockResolvedValue(geminiRaw({ promptFeedback: { blockReason: 'SAFETY' } }));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('SAFETY');
  });

  it('throws a response-kind error when generation was truncated', async () => {
    fetchMock.mockResolvedValue(geminiOk('[{"tempId":"f0"', 'MAX_TOKENS'));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('MAX_TOKENS');
  });

  it('throws a response-kind error when there are no candidates', async () => {
    fetchMock.mockResolvedValue(geminiRaw({ candidates: [] }));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('no candidates');
  });

  it('throws a response-kind error on an empty answer', async () => {
    fetchMock.mockResolvedValue(geminiOk('   '));
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('empty answer');
  });
});

describe('GeminiGenerator model failover and recovery', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fakeBrowser.reset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await saveSettings({ apiKey: API_KEY, modelId: MODEL_ID });
    await saveAvailableModels([{ id: FALLBACK_MODEL_ID, label: 'Fallback model from API' }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('automatically fails over to next model on 429 quota exceeded without changing the selection', async () => {
    // First call (MODEL_ID) fails with 429 quota exceeded
    // Second call (fallback model) succeeds with answers
    fetchMock
      .mockResolvedValueOnce(
        httpError(429, {
          error: {
            code: 429,
            message: 'Quota exceeded for requests.',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
      )
      .mockResolvedValueOnce(geminiOk(JSON.stringify(answers)));

    const result = await new GeminiGenerator().generate(prompt);
    expect(result).toEqual(answers);

    // Two attempts should have been made
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Failover only applies to this request, preserving the user's selected model.
    const settings = await getSettings();
    expect(settings.modelId).toBe(MODEL_ID);
  });

  it('automatically fails over to next model on 404 model not found', async () => {
    fetchMock
      .mockResolvedValueOnce(
        httpError(404, {
          error: { code: 404, message: 'Model not found or deprecated.', status: 'NOT_FOUND' },
        }),
      )
      .mockResolvedValueOnce(geminiOk(JSON.stringify(answers)));

    const result = await new GeminiGenerator().generate(prompt);
    expect(result).toEqual(answers);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fail over on 401 invalid API key because all models would fail', async () => {
    fetchMock.mockResolvedValueOnce(
      httpError(401, {
        error: { code: 401, message: 'API key not valid.', status: 'UNAUTHENTICATED' },
      }),
    );

    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(401);
    // Should stop immediately after first attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('GeminiGenerator configuration guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeBrowser.reset();
    fetchMock = vi.fn().mockResolvedValue(geminiOk(JSON.stringify(answers)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a config-kind error and sends nothing when no key is saved', async () => {
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('config');
    expect(error.message).toMatch(/options page/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only key as missing', async () => {
    await saveSettings({ apiKey: '   ', modelId: MODEL_ID });
    const error = await captureError(new GeminiGenerator().generate(prompt));
    expect(error.kind).toBe('config');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchGeminiModels', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeBrowser.reset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches models, filters to generateContent models, and formats choices', async () => {
    const rawPayload = {
      models: [
        {
          name: 'models/gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          description: 'Next generation model',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/text-embedding-004',
          displayName: 'Text Embedding 004',
          supportedGenerationMethods: ['embedContent'],
        },
        {
          name: 'models/gemini-1.5-pro',
          displayName: 'Gemini 1.5 Pro',
          supportedGenerationMethods: ['generateContent'],
        },
      ],
    };

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(rawPayload),
    });

    const models = await fetchGeminiModels(API_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      GEMINI_MODELS_BASE,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-goog-api-key': API_KEY }),
      }),
    );

    // Text embedding model should be excluded
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.id)).toEqual(['gemini-1.5-pro', 'gemini-2.5-flash']);
    expect(models[1]!.label).toBe('Gemini 2.5 Flash (gemini-2.5-flash)');
    expect(models[1]!.description).toBe('Next generation model');
  });

  it('ranks higher-capability families and newer versions before lighter models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          models: [
            {
              name: 'models/unknown-family-9',
              displayName: 'General Model',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/example-pro-2.0',
              displayName: 'Example Pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/example-pro-1.0',
              displayName: 'Example Pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/example-flash-10.0',
              displayName: 'Example Flash',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
    });

    const models = await fetchGeminiModels(API_KEY);
    expect(models.map((model) => model.id)).toEqual([
      'example-pro-2.0',
      'example-pro-1.0',
      'unknown-family-9',
      'example-flash-10.0',
    ]);
  });

  it('throws config error if no API key is provided and none stored', async () => {
    const error = await captureError(fetchGeminiModels(''));
    expect(error.kind).toBe('config');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('handles HTTP error responses gracefully', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve(JSON.stringify({ error: { message: 'API key invalid' } })),
    });

    const error = await captureError(fetchGeminiModels(API_KEY));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(401);
  });
});

/** Await a rejection and return it typed, so `kind`/`status` can be asserted. */
async function captureError(promise: Promise<unknown>): Promise<GeneratorError> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(GeneratorError);
    return caught as GeneratorError;
  }
  throw new Error('Expected the generator to reject, but it resolved');
}
