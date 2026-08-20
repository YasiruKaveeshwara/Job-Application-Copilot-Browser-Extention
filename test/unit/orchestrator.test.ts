import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { generateAnswers, describeGenerationFailure } from '../../lib/orchestrator';
import { MockGenerator } from '../../lib/generator/mock-generator';
import { GeneratorError } from '../../lib/generator/types';
import type { BuiltPrompt, Generator } from '../../lib/generator/types';
import { MOCK_GENERATOR_FLAG, usingMockGenerator } from '../../lib/generator';
import { saveProfile, saveSettings, emptyProfile, DEFAULT_MODEL_ID } from '../../lib/storage';
import { getFieldMappings, saveFieldMapping } from '../../lib/mapping-cache';
import { sendMessage } from '../../lib/messaging';
import background from '../../entrypoints/background';
import type { DetectedField, GeneratedAnswer, JobContext, ProfileData } from '../../lib/types';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    tempId: 'f0',
    resolvedLabel: 'Describe your React Native experience',
    labelConfidence: 'structured',
    elementType: 'textarea',
    domRef: 'jac-1',
    currentValue: '',
    surroundingText: '',
    ...overrides,
  };
}

const context: JobContext = {
  rawText: 'We are hiring a mobile engineer to own our React Native app.',
  url: 'https://jobs.example.com/roles/42',
  pageTitle: 'Mobile Engineer',
};

function profile(): ProfileData {
  return {
    ...emptyProfile(),
    projects: [
      {
        name: 'Trailmark',
        description: 'Offline hiking companion',
        individualOrGroup: 'individual',
        techStack: ['React Native', 'SQLite'],
        narrativeFragments: ['Shipped the React Native build to both stores single-handedly'],
      },
    ],
    stylePreferences: { tone: 'warm but direct', avoid: ['buzzwords'], length: 'concise' },
  };
}

/** A generator that records the prompt it was handed and returns fixed answers. */
function capturing(answers: unknown): { generator: Generator; prompts: BuiltPrompt[] } {
  const prompts: BuiltPrompt[] = [];
  const generator: Generator = {
    generate: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(answers as GeneratedAnswer[]);
    },
  };
  return { generator, prompts };
}

function throwing(error: unknown): Generator {
  return { generate: () => Promise.reject(error) };
}

const answerFor = (tempId: string): GeneratedAnswer => ({
  tempId,
  classifiedType: 'experience-summary',
  confidence: 'high',
  draftAnswer: 'I shipped a React Native app to both stores.',
});

/**
 * Re-install the fake extension APIs.
 *
 * WXT's vitest setup installs them with `vi.stubGlobal`, so the
 * `vi.unstubAllGlobals()` that cleans up a `fetch` stub takes global `chrome`
 * and `browser` with it — and `@webext-core/messaging` reads global `chrome`
 * directly. Without this, stubbing fetch in one test breaks message passing in
 * the next.
 */
function installExtensionGlobals(): void {
  vi.stubGlobal('chrome', fakeBrowser);
  vi.stubGlobal('browser', fakeBrowser);
}

describe('generateAnswers', () => {
  beforeEach(() => {
    installExtensionGlobals();
    fakeBrowser.reset();
    // The failure paths log the real error for the service worker log; keep it
    // out of the test output while still asserting the mapped message.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns one answer per field for a well-behaved generator', async () => {
    await saveProfile(profile());

    const answers = await generateAnswers(
      { fields: [field({ tempId: 'f0' }), field({ tempId: 'f1' })], context },
      new MockGenerator(),
    );

    expect(answers).toHaveLength(2);
    expect(answers.map((a) => a.tempId)).toEqual(['f0', 'f1']);
    expect(answers[0]!.confidence).toBe('high');
  });

  it('does not call the generator at all when no fields were detected', async () => {
    const { generator, prompts } = capturing([]);
    await expect(generateAnswers({ fields: [], context }, generator)).resolves.toEqual([]);
    // No fields means no prompt and no spend.
    expect(prompts).toHaveLength(0);
  });

  it('feeds retrieved profile fragments into the prompt', async () => {
    await saveProfile(profile());
    const { generator, prompts } = capturing([answerFor('f0')]);

    await generateAnswers({ fields: [field()], context }, generator);

    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.user).toContain('Trailmark');
    expect(prompts[0]!.user).toContain('both stores');
  });

  it("applies the stored profile's style preferences", async () => {
    await saveProfile(profile());
    const { generator, prompts } = capturing([answerFor('f0')]);

    await generateAnswers({ fields: [field()], context }, generator);

    expect(prompts[0]!.user).toContain('Tone: warm but direct');
    expect(prompts[0]!.user).toContain('Avoid entirely: buzzwords');
  });

  it('works with an empty profile, sending no fragments rather than failing', async () => {
    const { generator, prompts } = capturing([answerFor('f0')]);

    const answers = await generateAnswers({ fields: [field()], context }, generator);

    expect(answers).toHaveLength(1);
    expect(prompts[0]!.user).toContain('none matched');
  });

  it('adds a saved correction for this site to the prompt, and only for its own field', async () => {
    await saveFieldMapping({
      domain: 'jobs.example.com',
      resolvedLabel: 'Notice period',
      correctedType: 'availability',
    });
    const { generator, prompts } = capturing([answerFor('f0'), answerFor('f1')]);

    await generateAnswers(
      {
        fields: [
          field({ tempId: 'f0' }),
          field({ tempId: 'f1', resolvedLabel: 'Notice period', elementType: 'input:text' }),
        ],
        context,
      },
      generator,
    );

    const [, firstBlock, correctedBlock] = prompts[0]!.user.split('### Field ');
    expect(correctedBlock).toContain('"availability"');
    expect(firstBlock).not.toContain('previously corrected');
  });

  it('generates normally for a site with no saved corrections', async () => {
    const { generator, prompts } = capturing([answerFor('f0')]);

    await generateAnswers({ fields: [field()], context }, generator);

    // The mapping cache is a convenience layer; its absence is the default path.
    expect(prompts[0]!.user).not.toContain('previously corrected');
  });

  it('drops an answer whose tempId was never asked about', async () => {
    const { generator } = capturing([answerFor('f0'), answerFor('hallucinated')]);

    const answers = await generateAnswers(
      { fields: [field({ tempId: 'f0' })], context },
      generator,
    );

    // One bad id must not cost the user the drafts that were fine.
    expect(answers.map((a) => a.tempId)).toEqual(['f0']);
  });

  it('keeps the first of two answers for the same field', async () => {
    const first = { ...answerFor('f0'), draftAnswer: 'first' };
    const second = { ...answerFor('f0'), draftAnswer: 'second' };
    const { generator } = capturing([first, second]);

    const answers = await generateAnswers(
      { fields: [field({ tempId: 'f0' })], context },
      generator,
    );

    expect(answers).toHaveLength(1);
    expect(answers[0]!.draftAnswer).toBe('first');
  });

  it('returns answers in the order the fields were sent, not the order returned', async () => {
    const { generator } = capturing([answerFor('f2'), answerFor('f0'), answerFor('f1')]);
    const fields = [field({ tempId: 'f0' }), field({ tempId: 'f1' }), field({ tempId: 'f2' })];

    const answers = await generateAnswers({ fields, context }, generator);

    expect(answers.map((a) => a.tempId)).toEqual(['f0', 'f1', 'f2']);
  });

  it('omits a field the model skipped instead of fabricating an answer for it', async () => {
    const { generator } = capturing([answerFor('f0')]);
    const fields = [field({ tempId: 'f0' }), field({ tempId: 'f1' })];

    const answers = await generateAnswers({ fields, context }, generator);

    expect(answers.map((a) => a.tempId)).toEqual(['f0']);
  });

  it('rejects with a clean message when a generator returns malformed answers', async () => {
    // A Generator written later could hand back whatever its provider said; the
    // orchestrator is the boundary the UI trusts, so it validates regardless.
    const { generator } = capturing([{ tempId: 'f0', confidence: 'maybe' }]);

    await expect(generateAnswers({ fields: [field()], context }, generator)).rejects.toThrow(
      /Could not draft answers/,
    );
  });

  it('never surfaces raw model text to the UI on a schema failure', async () => {
    const raw = 'Sure! Here are your answers: [not really json]';
    const { generator } = capturing(raw);

    const error = await generateAnswers({ fields: [field()], context }, generator).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('Sure!');
    expect((error as Error).message).not.toContain('not really json');
  });

  it('maps a missing API key to an actionable message without calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const generator = throwing(
      new GeneratorError(
        'config',
        'No Gemini API key saved. Add one on the extension options page.',
      ),
    );

    await expect(generateAnswers({ fields: [field()], context }, generator)).rejects.toThrow(
      'No Gemini API key saved. Add one on the extension options page.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs the underlying error, and only the error, for the service worker log', async () => {
    await saveProfile(profile());
    await saveSettings({ apiKey: 'AIza-secret-key', modelId: DEFAULT_MODEL_ID });
    const cause = new GeneratorError('network', 'Request to Gemini failed.');

    const error = await generateAnswers({ fields: [field()], context }, throwing(cause)).catch(
      (caught: unknown) => caught,
    );

    // The full error goes to the log — but nothing else: not the prompt (which
    // holds the profile) and not the key.
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ['[job-copilot] generation failed', cause],
    ]);
    expect((error as Error).message).not.toContain('AIza-secret-key');
    expect((error as Error).message).not.toContain('Trailmark');
  });
});

describe('describeGenerationFailure', () => {
  it('explains each HTTP status the user can act on', () => {
    const http = (status: number) =>
      describeGenerationFailure(new GeneratorError('http', 'Gemini request failed.', { status }));

    expect(http(400)).toMatch(/model ID/);
    expect(http(401)).toMatch(/rejected the API key/);
    expect(http(403)).toMatch(/rejected the API key/);
    expect(http(404)).toMatch(/does not recognise that model/);
    expect(http(429)).toMatch(/rate-limiting/);
    expect(http(503)).toMatch(/server error/);
    expect(http(418)).toMatch(/HTTP 418/);
  });

  it('explains a network failure without blaming the user', () => {
    expect(describeGenerationFailure(new GeneratorError('network', 'boom'))).toMatch(
      /Could not reach the Gemini API/,
    );
  });

  it('passes through a response-shape failure, which never quotes model output', () => {
    const error = new GeneratorError(
      'response',
      'Gemini stopped early (finishReason: MAX_TOKENS).',
    );
    expect(describeGenerationFailure(error)).toMatch(/MAX_TOKENS/);
  });

  it('falls back to a generic message for anything that is not a GeneratorError', () => {
    for (const thrown of [new TypeError('storage exploded'), 'a string', undefined]) {
      expect(describeGenerationFailure(thrown)).toBe(
        'Could not draft answers. See the extension service worker log for details.',
      );
    }
  });
});

describe('background REQUEST_GENERATION handler', () => {
  beforeAll(() => {
    installExtensionGlobals();
    // Startup also binds the side panel to the toolbar icon. The fake browser
    // has no implementation for that, and the background is written to shrug it
    // off, so stub it rather than let a warning print on every run.
    vi.spyOn(fakeBrowser.sidePanel, 'setPanelBehavior').mockResolvedValue(undefined);
    // The messaging library permits one listener per message type per JS context
    // — correct for a service worker, which registers once on startup. So the
    // background is started once for this file rather than once per test.
    background.main?.();
  });

  beforeEach(async () => {
    installExtensionGlobals();
    // Clear stored data directly rather than with fakeBrowser.reset(): reset()
    // also drops the runtime.onMessage listener the background registered above,
    // and the messaging library refuses a second registration in one context.
    await fakeBrowser.storage.local.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('answers a REQUEST_GENERATION message end to end with the mock generator', async () => {
    vi.stubEnv(MOCK_GENERATOR_FLAG, 'true');
    expect(usingMockGenerator()).toBe(true);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await saveProfile(profile());
    const answers = await sendMessage('REQUEST_GENERATION', {
      fields: [field({ tempId: 'f0' }), field({ tempId: 'f1', resolvedLabel: 'Cover Letter' })],
      context,
    });

    expect(answers).toHaveLength(2);
    expect(answers.map((a) => a.tempId)).toEqual(['f0', 'f1']);
    for (const answer of answers) {
      expect(answer.classifiedType).not.toBe('');
      expect(['high', 'low']).toContain(answer.confidence);
      expect(typeof answer.draftAnswer).toBe('string');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a clean error back to the caller instead of leaving an unhandled rejection', async () => {
    // Mock generator off and no API key stored: the real generator fails on
    // config before it ever builds a request.
    vi.stubEnv(MOCK_GENERATOR_FLAG, '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendMessage('REQUEST_GENERATION', { fields: [field()], context })).rejects.toThrow(
      /API key/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists a correction sent as a SAVE_FIELD_MAPPING message', async () => {
    await sendMessage('SAVE_FIELD_MAPPING', {
      domain: 'jobs.example.com',
      resolvedLabel: 'Tell us about you',
      correctedType: 'cover letter',
    });

    expect(await getFieldMappings('jobs.example.com')).toEqual([
      { resolvedLabel: 'Tell us about you', correctedType: 'cover letter' },
    ]);
  });

  it('rejects an unusable correction so the card can say it was not saved', async () => {
    await expect(
      sendMessage('SAVE_FIELD_MAPPING', {
        domain: 'jobs.example.com',
        resolvedLabel: '',
        correctedType: 'cover letter',
      }),
    ).rejects.toThrow(/needs a site, a field label/);
    expect(await getFieldMappings('jobs.example.com')).toEqual([]);
  });

  it('still generates end to end when a correction is saved for the site', async () => {
    vi.stubEnv(MOCK_GENERATOR_FLAG, 'true');
    await saveProfile(profile());
    await sendMessage('SAVE_FIELD_MAPPING', {
      domain: 'jobs.example.com',
      resolvedLabel: 'Notice period',
      correctedType: 'availability',
    });

    // Reading the hint happens on the generation path, so a broken read would
    // cost the drafts. That the hint reaches the prompt is asserted above, where
    // the prompt is visible.
    const answers = await sendMessage('REQUEST_GENERATION', {
      fields: [field({ tempId: 'f0', resolvedLabel: 'Notice period' })],
      context,
    });

    expect(answers).toHaveLength(1);
    expect(await getFieldMappings('jobs.example.com')).toHaveLength(1);
  });
});
