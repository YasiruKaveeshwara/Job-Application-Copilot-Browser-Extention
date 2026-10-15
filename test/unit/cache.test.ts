import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { storage } from '#imports';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  answerCacheKeys,
  clearAnswerCache,
  countCachedAnswers,
  isStale,
  readCachedAnswers,
  writeCachedAnswers,
} from '../../lib/cache';
import type { CacheInputs } from '../../lib/cache';
import { emptyProfile } from '../../lib/storage';
import type { GeneratedAnswer, JobContext } from '../../lib/types';

// Phase 15. Two properties matter: a draft comes back only when everything that
// produced it is unchanged, and every failure mode ends in "generate it again"
// rather than in an error or a wrong draft.

const context: JobContext = {
  rawText: 'We are hiring a mobile engineer to own our React Native app.',
  url: 'https://jobs.example.com/roles/42',
  pageTitle: 'Mobile Engineer',
};

function inputs(overrides: Partial<CacheInputs> = {}): CacheInputs {
  return {
    field: { tempId: 'f0', resolvedLabel: 'Cover Letter', elementType: 'textarea' },
    context,
    fragments: ['Project "Trailmark": shipped a React Native app to both stores'],
    style: emptyProfile().stylePreferences,
    hint: '',
    modelId: 'gemini-test-model',
    ...overrides,
  };
}

function answer(overrides: Partial<GeneratedAnswer> = {}): GeneratedAnswer {
  return {
    tempId: 'f0',
    classifiedType: 'cover-letter',
    confidence: 'high',
    draftAnswer: 'I ship offline-first mobile apps, mostly React Native.',
    ...overrides,
  };
}

/** The single key for one field's inputs. */
async function keyOf(input: CacheInputs): Promise<string> {
  const keys = await answerCacheKeys([input]);
  const key = keys[input.field.tempId];
  expect(key, 'expected a cache key for this field').toBeDefined();
  return key!;
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('answerCacheKeys', () => {
  it('is stable for the same inputs and independent of the field id', async () => {
    const first = await keyOf(inputs());
    const second = await keyOf(inputs());
    // The id is minted per scan; keying on it would mean never hitting the cache.
    const renamed = await keyOf(
      inputs({ field: { tempId: 'f9', resolvedLabel: 'Cover Letter', elementType: 'textarea' } }),
    );

    expect(second).toBe(first);
    expect(renamed).toBe(first);
    // A hash, not the inputs: the label and the profile fragment must not be
    // readable off the stored key.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain('Trailmark');
  });

  it('changes when anything that decides the draft changes', async () => {
    const base = await keyOf(inputs());
    const variants = {
      label: inputs({
        field: { tempId: 'f0', resolvedLabel: 'Why us?', elementType: 'textarea' },
      }),
      elementType: inputs({
        field: { tempId: 'f0', resolvedLabel: 'Cover Letter', elementType: 'input:text' },
      }),
      site: inputs({ context: { ...context, url: 'https://other.example.com/apply' } }),
      roleFamily: inputs({ context: { ...context, pageTitle: 'Data Engineer' } }),
      profile: inputs({ fragments: ['Project "Trailmark": rewrote the sync layer'] }),
      fragmentOrder: inputs({ fragments: ['second', 'first'] }),
      tone: inputs({ style: { tone: 'warm but direct', avoid: [], length: 'standard' } }),
      length: inputs({ style: { tone: '', avoid: [], length: 'detailed' } }),
      avoid: inputs({ style: { tone: '', avoid: ['buzzwords'], length: 'standard' } }),
      correction: inputs({ hint: 'salary expectation' }),
      model: inputs({ modelId: 'gemini-3.5-flash-lite' }),
      prompt: inputs({ promptSignature: 'custom system prompt' }),
    };

    const keys = new Map<string, string>();
    for (const [name, variant] of Object.entries(variants)) {
      keys.set(name, await keyOf(variant));
    }

    for (const [name, key] of keys) {
      expect(key, `${name} should not share a key with the baseline`).not.toBe(base);
    }
    // And no two variants collide with each other either.
    expect(new Set(keys.values()).size).toBe(keys.size);
  });

  it('ignores the job text and the path, which is what makes a hit possible', async () => {
    const base = await keyOf(inputs());

    // Same role family, same question, same site: a different posting for the
    // same kind of job is the case this cache exists for.
    expect(
      await keyOf(
        inputs({
          context: {
            rawText: 'Completely different posting text.',
            url: 'https://jobs.example.com/roles/999?src=email',
            pageTitle: 'React Native Developer',
          },
        }),
      ),
    ).toBe(base);
  });

  it('treats a label as the same question across spacing and casing', async () => {
    expect(
      await keyOf(
        inputs({
          field: { tempId: 'f0', resolvedLabel: '  cover   LETTER ', elementType: 'textarea' },
        }),
      ),
    ).toBe(await keyOf(inputs()));
  });

  it('skips a field it could not key dependably', async () => {
    const keys = await answerCacheKeys([
      inputs({ field: { tempId: 'noLabel', resolvedLabel: '   ', elementType: 'textarea' } }),
      inputs({
        field: { tempId: 'noSite', resolvedLabel: 'Cover Letter', elementType: 'textarea' },
        context: { ...context, url: 'not a url' },
      }),
      inputs({ field: { tempId: 'fine', resolvedLabel: 'Cover Letter', elementType: 'textarea' } }),
    ]);

    // Better to pay for these than to serve a draft keyed on almost nothing.
    expect(Object.keys(keys)).toEqual(['fine']);
  });
});

describe('writeCachedAnswers / readCachedAnswers', () => {
  it('returns a stored draft under the current scan’s field id', async () => {
    const written = inputs();
    const keys = await answerCacheKeys([written]);
    await writeCachedAnswers(keys, [answer()]);

    // Same question, next scan: a fresh tempId, and the draft must follow it.
    const later = inputs({
      field: { tempId: 'f7', resolvedLabel: 'Cover Letter', elementType: 'textarea' },
    });
    const hits = await readCachedAnswers(await answerCacheKeys([later]));

    expect(hits).toEqual({ f7: { ...answer(), tempId: 'f7' } });
  });

  it('has nothing for a question it has not answered before', async () => {
    await expect(readCachedAnswers(await answerCacheKeys([inputs()]))).resolves.toEqual({});
    await expect(readCachedAnswers({})).resolves.toEqual({});
  });

  it('stores nothing for an answer whose field had no key', async () => {
    await writeCachedAnswers({}, [answer()]);
    expect(await countCachedAnswers()).toBe(0);
  });

  it('stops serving a draft once it has expired', async () => {
    const key = await keyOf(inputs());
    const now = Date.now();
    await storage.setItem('local:answerCache', {
      [key]: { answer: { ...answer(), tempId: undefined }, savedAt: now - CACHE_TTL_MS - 1 },
    });

    // The job text is not in the key, so time is the only thing that can retire
    // a draft written for a situation that has moved on.
    expect(await readCachedAnswers(await answerCacheKeys([inputs()]))).toEqual({});
  });

  it('refuses a draft stamped in the future rather than serving it forever', () => {
    const now = Date.now();
    expect(isStale({ answer: answer(), savedAt: now + 60_000 }, now)).toBe(true);
    expect(isStale({ answer: answer(), savedAt: now - 60_000 }, now)).toBe(false);
    expect(isStale({ answer: answer(), savedAt: now - CACHE_TTL_MS + 1_000 }, now)).toBe(false);
  });

  it('discards an entry that no longer validates instead of showing it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const key = await keyOf(inputs());
    await storage.setItem('local:answerCache', {
      // Storage is not more trustworthy than model output, only older.
      [key]: {
        answer: { classifiedType: 'cover-letter', confidence: 'maybe' },
        savedAt: Date.now(),
      },
    });

    expect(await readCachedAnswers(await answerCacheKeys([inputs()]))).toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('serves no draft, and no error, when storage cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const keys = await answerCacheKeys([inputs()]);
    await writeCachedAnswers(keys, [answer()]);
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('storage is gone'));

    // A cache miss costs one generation; a rejection here would cost the scan.
    await expect(readCachedAnswers(keys)).resolves.toEqual({});
    expect(warn).toHaveBeenCalled();
  });

  it('swallows a failed write, because the answers are already in hand', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const keys = await answerCacheKeys([inputs()]);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota exceeded'));

    await expect(writeCachedAnswers(keys, [answer()])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('caps the store, dropping the oldest drafts first', async () => {
    // Nothing else prunes this; without the cap a heavy user's cache grows for
    // as long as the extension is installed.
    const overflow = MAX_CACHE_ENTRIES + 5;
    const store: Record<string, { answer: Omit<GeneratedAnswer, 'tempId'>; savedAt: number }> = {};
    const base = Date.now() - 60_000;
    for (let i = 0; i < overflow; i++) {
      store[`key-${i}`] = {
        answer: { ...answer({ draftAnswer: `draft ${i}` }), tempId: undefined } as Omit<
          GeneratedAnswer,
          'tempId'
        >,
        savedAt: base + i,
      };
    }
    await storage.setItem('local:answerCache', store);

    const keys = await answerCacheKeys([inputs()]);
    await writeCachedAnswers(keys, [answer()]);

    expect(await countCachedAnswers()).toBe(MAX_CACHE_ENTRIES);
    // The newest write survived, the oldest pre-existing entries did not.
    expect(await readCachedAnswers(keys)).toEqual({ f0: answer() });
    const stored = (await storage.getItem<Record<string, unknown>>('local:answerCache')) ?? {};
    expect(stored['key-0']).toBeUndefined();
    expect(stored[`key-${overflow - 1}`]).toBeDefined();
  });

  it('drops expired entries on the next write, not only on read', async () => {
    const stale = { answer: answer(), savedAt: Date.now() - CACHE_TTL_MS - 1 };
    await storage.setItem('local:answerCache', { 'old-key': stale });

    await writeCachedAnswers(await answerCacheKeys([inputs()]), [answer()]);

    expect(await countCachedAnswers()).toBe(1);
  });

  it('forgets everything on request', async () => {
    const keys = await answerCacheKeys([inputs()]);
    await writeCachedAnswers(keys, [answer()]);
    expect(await countCachedAnswers()).toBe(1);

    await clearAnswerCache();
    expect(await countCachedAnswers()).toBe(0);
    expect(await readCachedAnswers(keys)).toEqual({});
  });
});
