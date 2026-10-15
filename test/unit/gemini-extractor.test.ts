import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveSettings, savePromptSettings, saveAvailableModels } from '../../lib/storage';
import { DEFAULT_PROMPT_SETTINGS } from '../../lib/prompt-settings';
import { GeminiExtractor, EXTRACTION_INSTRUCTION } from '../../lib/extractor/gemini-extractor';
import { MockExtractor, MOCK_EXTRACTED_CV } from '../../lib/extractor/mock-extractor';
import { MAX_PDF_BYTES, base64ByteLength, checkPdfSize } from '../../lib/extractor/types';
import type { ProfileExtractor } from '../../lib/extractor/types';
import {
  GEMINI_MODELS_BASE,
  GEMINI_REQUEST_TIMEOUT_MS,
  generateContentUrl,
} from '../../lib/gemini-client';
import { GeneratorError } from '../../lib/generator/types';
import type { ExtractedProfileData } from '../../lib/types';

// Every test here runs against a stubbed global fetch and asserts on that stub,
// so a real network call is impossible: an unstubbed request would fail the
// call-count assertion rather than quietly hitting Google — and no test needs a
// real PDF, because the extractor never parses one itself.

const API_KEY = 'test-api-key-value';
const MODEL_ID = 'gemini-test-model';
const SECOND_MODEL_ID = 'gemini-test-second-model';

/** Stand-in for an uploaded CV: valid base64, and not a real document. */
const PDF_BASE64 = btoa('%PDF-1.7 not really a PDF, and it does not need to be');

const extracted: ExtractedProfileData = {
  personal: { name: 'Grace Hopper', email: 'grace@example.com' },
  education: [{ institution: 'Yale', program: 'PhD Mathematics', dates: '1930 – 1934' }],
  skills: ['COBOL'],
};

function geminiOk(text: string, finishReason: string | undefined = 'STOP'): Response {
  const payload = {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }],
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

function callArgs(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): {
  contents: { role: string; parts: Record<string, unknown>[] }[];
  generationConfig: Record<string, unknown>;
} {
  return JSON.parse(callArgs(fetchMock).init.body as string);
}

describe('GeminiExtractor request shape', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fakeBrowser.reset();
    fetchMock = vi.fn().mockResolvedValue(geminiOk(JSON.stringify(extracted)));
    vi.stubGlobal('fetch', fetchMock);
    await saveSettings({ apiKey: API_KEY, modelId: MODEL_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the generateContent endpoint for the model ID from settings', async () => {
    await new GeminiExtractor().extract(PDF_BASE64);
    const { url, init } = callArgs(fetchMock);

    expect(url).toBe(`${GEMINI_MODELS_BASE}/${MODEL_ID}:generateContent`);
    expect(url).toBe(generateContentUrl(MODEL_ID));
    expect(init.method).toBe('POST');
  });

  it('shares the transport with the generator: key in the header, never the URL', async () => {
    await saveSettings({ apiKey: API_KEY, modelId: SECOND_MODEL_ID });
    await new GeminiExtractor().extract(PDF_BASE64);
    const { url, init } = callArgs(fetchMock);
    const headers = init.headers as Record<string, string>;

    expect(url).toContain(`${SECOND_MODEL_ID}:generateContent`);
    expect(headers['x-goog-api-key']).toBe(API_KEY);
    expect(headers['content-type']).toBe('application/json');
    expect(url).not.toContain(API_KEY);
    expect(url).not.toContain('key=');
  });

  it('sends the PDF inline as application/pdf, with no upload step', async () => {
    await new GeminiExtractor().extract(PDF_BASE64);
    const parts = bodyOf(fetchMock).contents[0]!.parts;

    expect(bodyOf(fetchMock).contents).toHaveLength(1);
    expect(bodyOf(fetchMock).contents[0]!.role).toBe('user');
    expect(parts[0]!.inlineData).toEqual({ mimeType: 'application/pdf', data: PDF_BASE64 });
  });

  it('sends the saved CV extraction prompt rather than only the seed text', async () => {
    const customInstruction = 'Read this resume using my instructions.';
    await savePromptSettings({
      ...DEFAULT_PROMPT_SETTINGS,
      cvExtractionInstruction: customInstruction,
    });

    await new GeminiExtractor().extract(PDF_BASE64);
    const parts = bodyOf(fetchMock).contents[0]!.parts;
    expect(parts[1]!.text).toBe(customInstruction);
  });

  it('sends the extraction instruction verbatim, after the document', async () => {
    await new GeminiExtractor().extract(PDF_BASE64);
    const parts = bodyOf(fetchMock).contents[0]!.parts;

    expect(parts).toHaveLength(2);
    expect(parts[1]!.text).toBe(EXTRACTION_INSTRUCTION);
    // The clauses that make the feature honest, spelled out so a reword that
    // drops one fails here rather than in someone's imported profile.
    expect(EXTRACTION_INSTRUCTION).toContain('Return only JSON matching the provided schema.');
    expect(EXTRACTION_INSTRUCTION).toContain(
      'Do not invent or infer anything not explicitly present in the document.',
    );
    expect(EXTRACTION_INSTRUCTION).toContain('omit it entirely rather than guessing');
    expect(EXTRACTION_INSTRUCTION).toContain('Do not include any text outside the JSON object.');
  });

  it('constrains the response to the extraction schema', async () => {
    await new GeminiExtractor().extract(PDF_BASE64);
    const config = bodyOf(fetchMock).generationConfig;
    const schema = config.responseSchema as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(config.responseMimeType).toBe('application/json');
    expect(schema.type).toBe('OBJECT');
    expect(Object.keys(schema.properties)).toEqual([
      'personal',
      'education',
      'workHistory',
      'projectsRaw',
      'skills',
    ]);
    // Nothing required at the top level: "omit it entirely rather than guessing"
    // has to be possible for the whole request to be honest.
    expect(schema.required).toBeUndefined();
    expect(config.maxOutputTokens).toBeGreaterThan(0);
  });

  it('never shows the model a slot for a field a CV may not fill', async () => {
    await new GeminiExtractor().extract(PDF_BASE64);
    const schema = JSON.stringify(bodyOf(fetchMock).generationConfig.responseSchema);

    for (const forbidden of [
      'individualOrGroup',
      'narrativeFragments',
      'standardAnswers',
      'stylePreferences',
      'resumeVariants',
    ]) {
      expect(schema).not.toContain(forbidden);
    }
  });

  it('does not override sampling parameters, matching the generator', async () => {
    await new GeminiExtractor().extract(PDF_BASE64);
    const config = bodyOf(fetchMock).generationConfig;
    expect(config.temperature).toBeUndefined();
    expect(config.topP).toBeUndefined();
    expect(config.topK).toBeUndefined();
  });

  it('honours an overridden maxOutputTokens', async () => {
    await new GeminiExtractor({ maxOutputTokens: 512 }).extract(PDF_BASE64);
    expect(bodyOf(fetchMock).generationConfig.maxOutputTokens).toBe(512);
  });
});

describe('GeminiExtractor response handling', () => {
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

  it('returns the extracted data for a well-formed response', async () => {
    fetchMock.mockResolvedValue(geminiOk(JSON.stringify(extracted)));
    await expect(new GeminiExtractor().extract(PDF_BASE64)).resolves.toEqual(extracted);
  });

  it('throws a catchable error, not a crash, when the reply is not JSON', async () => {
    fetchMock.mockResolvedValue(geminiOk('I read the CV. Here is what I found: …'));
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('not valid JSON');
  });

  it('throws when the reply contains a field a CV may never fill', async () => {
    fetchMock.mockResolvedValue(
      geminiOk(
        JSON.stringify({
          projectsRaw: [{ name: 'COBOL', description: 'x', individualOrGroup: 'individual' }],
        }),
      ),
    );
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('individualOrGroup');
  });

  it('throws when the reply has the wrong type somewhere', async () => {
    fetchMock.mockResolvedValue(geminiOk(JSON.stringify({ skills: 'COBOL, FORTRAN' })));
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('skills');
  });

  it('reports a truncated reply as truncated rather than as broken JSON', async () => {
    fetchMock.mockResolvedValue(geminiOk('{"education":[{"institution":"Ya', 'MAX_TOKENS'));
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('response');
    expect(error.message).toContain('MAX_TOKENS');
  });

  it('reports an HTTP failure with its status and the API message', async () => {
    fetchMock.mockResolvedValue(
      httpError(413, { error: { code: 413, message: 'Request payload size exceeds the limit.' } }),
    );
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(413);
    expect(error.message).toContain('payload size');
  });

  it('reports a request that never landed as a network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('network');
  });

  it('tries an API-discovered fallback when the selected model rejects PDF input', async () => {
    await saveAvailableModels([{ id: SECOND_MODEL_ID, label: 'Fallback model' }]);
    fetchMock
      .mockResolvedValueOnce(
        httpError(400, { error: { code: 400, message: 'PDF input is not supported.' } }),
      )
      .mockResolvedValueOnce(geminiOk(JSON.stringify(extracted)));

    await expect(new GeminiExtractor().extract(PDF_BASE64)).resolves.toEqual(extracted);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toContain(`${MODEL_ID}:generateContent`);
    expect(fetchMock.mock.calls[1]![0]).toContain(`${SECOND_MODEL_ID}:generateContent`);
  });

  it('aborts a model request that never responds instead of leaving extraction loading', async () => {
    vi.useFakeTimers();
    try {
      let markFetchStarted = () => {};
      const fetchStarted = new Promise<void>((resolve) => {
        markFetchStarted = resolve;
      });
      fetchMock.mockImplementation(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            markFetchStarted();
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('The request was aborted.', 'AbortError')),
              { once: true },
            );
          }),
      );

      const pending = new GeminiExtractor().extract(PDF_BASE64);
      const capturedError = captureError(pending);
      await fetchStarted;
      await vi.advanceTimersByTimeAsync(GEMINI_REQUEST_TIMEOUT_MS);
      const error = await capturedError;

      expect(error.kind).toBe('network');
      expect(error.message).toContain('timed out');
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GeminiExtractor guards', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeBrowser.reset();
    fetchMock = vi.fn().mockResolvedValue(geminiOk(JSON.stringify(extracted)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends nothing when no API key is saved', async () => {
    const error = await captureError(new GeminiExtractor().extract(PDF_BASE64));
    expect(error.kind).toBe('config');
    expect(error.message).toMatch(/options page/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized PDF before spending a request on it', async () => {
    await saveSettings({ apiKey: API_KEY, modelId: MODEL_ID });
    // Base64 for something just past the cap. Cheaper than a real file, and it
    // exercises the same guard.
    const tooBig = 'A'.repeat(Math.ceil(((MAX_PDF_BYTES + 1024) * 4) / 3));

    const error = await captureError(new GeminiExtractor().extract(tooBig));
    // `config`, so the UI shows the sentence as written rather than a generic
    // failure: it tells the user what to do about it.
    expect(error.kind).toBe('config');
    expect(error.message).toMatch(/limit is 8 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty upload', async () => {
    await saveSettings({ apiKey: API_KEY, modelId: MODEL_ID });
    await expect(new GeminiExtractor().extract('')).rejects.toThrow(/empty/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('PDF size checks', () => {
  it('measures base64 without decoding it', () => {
    for (const sample of ['', 'a', 'ab', 'abc', 'hello world', '%PDF-1.7 binary']) {
      expect(base64ByteLength(btoa(sample))).toBe(sample.length);
    }
  });

  it('ignores the line breaks some encoders insert', () => {
    const base64 = btoa('a'.repeat(120));
    const wrapped = base64.replace(/(.{16})/g, '$1\n');
    expect(base64ByteLength(wrapped)).toBe(120);
  });

  it('accepts anything up to the cap and refuses what is past it', () => {
    expect(checkPdfSize(1)).toBeUndefined();
    expect(checkPdfSize(MAX_PDF_BYTES)).toBeUndefined();
    expect(checkPdfSize(MAX_PDF_BYTES + 1)).toContain('8 MB');
    expect(checkPdfSize(0)).toContain('empty');
  });

  it('says how big the file actually was, so the message is actionable', () => {
    expect(checkPdfSize(12 * 1024 * 1024)).toContain('12.0 MB');
  });
});

describe('MockExtractor', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Called through the interface rather than the class: the mock declares no
  // parameter, because it ignores the document on purpose, and a caller still
  // hands it one. Typing it as a `ProfileExtractor` here is what checks that the
  // substitution the background relies on is legal.
  const mock = (options?: ConstructorParameters<typeof MockExtractor>[0]): ProfileExtractor =>
    new MockExtractor(options);

  it('answers from canned data with no network call and no key', async () => {
    const result = await mock().extract(PDF_BASE64);
    expect(result).toEqual(MOCK_EXTRACTED_CV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers a fresh copy each time, so a caller cannot corrupt the next call', async () => {
    const first = await mock().extract(PDF_BASE64);
    first.skills?.push('Not from the CV');
    expect((await mock().extract(PDF_BASE64)).skills).toEqual(MOCK_EXTRACTED_CV.skills);
  });

  it('can be made to fail, for the UI error path', async () => {
    const error = await captureError(mock({ failWith: 'nope' }).extract(PDF_BASE64));
    expect(error).toBeInstanceOf(GeneratorError);
    expect(error.message).toBe('nope');
  });

  it('holds only data the schema would accept', async () => {
    // The canned CV is what every test and every manual run of the review screen
    // sees, so it has to be a legal extraction — including holding none of the
    // fields a CV may never fill.
    const { validateExtractedProfile } = await import('../../lib/extractor/schema');
    expect(validateExtractedProfile(await mock().extract(PDF_BASE64))).toEqual(MOCK_EXTRACTED_CV);
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
  throw new Error('Expected the extractor to reject, but it resolved');
}
