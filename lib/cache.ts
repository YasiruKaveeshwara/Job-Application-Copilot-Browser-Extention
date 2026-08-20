import { storage } from '#imports';
import { extractDomain, normalizeRoleFamily } from './job-context';
import { validateGeneratedAnswers } from './schema-validator';
import type { DetectedField, GeneratedAnswer, JobContext, ProfileData } from './types';

// Drafts already paid for, keyed by what actually determines them.
//
// The same person applies for the same kind of role over and over, and the same
// three questions ("cover letter", "why us", "notice period") come back on every
// site's form. Re-generating a draft for a (role family, question, site) the
// profile has not changed under is money and latency spent to get the same
// paragraph back (build guide, Phase 15).
//
// STALENESS POLICY
// Two mechanisms, deliberately different in kind:
//
//   1. Content changes invalidate by *key*, not by expiry. Everything that
//      materially decides the draft is hashed into the key: the role family, the
//      field's label and element type, the site, the profile fragments retrieved
//      for that field, the style preferences, any correction the user saved for
//      the label, and the model ID. Edit the profile and the next scan simply
//      computes a different key — the old entry is never read again, and is
//      evicted in time. Nothing has to remember to invalidate anything.
//
//   2. Time expiry catches what a key cannot see. A cached draft stops being
//      wanted long before it stops matching its key: the job market moves, the
//      user's sense of how they want to sound moves, and the job text itself is
//      *not* in the key (only its role family is, by design — that is what makes
//      the cache hit across sites at all). `CACHE_TTL_MS` is the cutoff, and it
//      is read at read time, so shortening it retroactively expires entries.
//
// The store is capped and the oldest entries go first, so a heavy user's cache
// cannot grow without bound. Losing the whole cache costs a re-generation and
// nothing else; that is the property that keeps it safe to clear at any time.

/**
 * How long a cached draft may be served.
 *
 * 7 days: long enough that a burst of applications for one role family reuses
 * its answers, short enough that a draft never long outlives the situation it
 * was written for. Documented in the README as part of what the cache promises.
 */
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Entries kept at most; oldest by `savedAt` are evicted first. */
export const MAX_CACHE_ENTRIES = 300;

/** Same `local:` prefix as everything else: on-device, never synced. */
const CACHE_KEY = 'local:answerCache' as const;
const CACHE_VERSION = 1;

/**
 * One cached draft.
 *
 * The answer is stored without its `tempId`: ids are minted per scan, so a
 * stored one would be stale by definition. The current scan's id is put back on
 * read.
 */
export interface AnswerCacheEntry {
  answer: Omit<GeneratedAnswer, 'tempId'>;
  /** Epoch milliseconds, for expiry and for eviction order. */
  savedAt: number;
}

type AnswerCacheStore = Record<string, AnswerCacheEntry>;

const cacheItem = storage.defineItem<AnswerCacheStore>(CACHE_KEY, {
  version: CACHE_VERSION,
  fallback: {},
});

/** Everything that decides one field's draft. Anything not here is not in the key. */
export interface CacheInputs {
  field: Pick<DetectedField, 'tempId' | 'resolvedLabel' | 'elementType'>;
  context: JobContext;
  /** The profile fragments retrieved for this field — the profile's only input. */
  fragments: string[];
  style: ProfileData['stylePreferences'];
  /** A saved correction for this label, or `''`. */
  hint: string;
  modelId: string;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The role-family bucket for a page, falling back to the normalized title.
 *
 * The bucket is what makes a draft reusable across employers: "Mobile Engineer"
 * at one company and "React Native Developer" at another are the same question
 * being asked. When no bucket matches, the raw title is used instead of a shared
 * "unknown" bucket — two genuinely different unrecognized roles must not collide
 * into each other's drafts.
 */
function roleBucket(context: JobContext): string {
  return normalizeRoleFamily(context.pageTitle) ?? normalize(context.pageTitle);
}

/**
 * The exact string that gets hashed.
 *
 * Each part is written length-prefixed, so no two different inputs can produce
 * the same material — a label of "a" with a fragment of "bc" and a label of "ab"
 * with a fragment of "c" are different strings here, which a plain delimiter
 * could not guarantee against text the user typed. Versioned, so a change to
 * what belongs in the key does not silently reuse entries computed under the old
 * rules.
 */
function keyMaterial(inputs: CacheInputs): string {
  const parts = [
    `v${CACHE_VERSION}`,
    roleBucket(inputs.context),
    normalize(inputs.field.resolvedLabel),
    inputs.field.elementType,
    extractDomain(inputs.context.url).toLowerCase(),
    inputs.modelId,
    normalize(inputs.hint),
    // The profile's contribution. Order matters and is preserved: retrieval
    // ranks fragments, and a different ranking is a different prompt.
    ...inputs.fragments,
    inputs.style.tone,
    inputs.style.length,
    ...inputs.style.avoid,
  ];
  return parts.map((part) => `${part.length}:${part}`).join('|');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 of the key material. Available in the service worker and in tests. */
async function hash(material: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return toHex(digest);
}

/**
 * Cache keys for a page's fields, keyed by `tempId`.
 *
 * A field is left out entirely when there is nothing dependable to key it on: no
 * site (an unparseable URL) or no label. Those fields are always generated fresh
 * rather than sharing a vague key with something else.
 */
export async function answerCacheKeys(inputs: CacheInputs[]): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  for (const input of inputs) {
    if (extractDomain(input.context.url).length === 0) continue;
    if (normalize(input.field.resolvedLabel).length === 0) continue;
    keys[input.field.tempId] = await hash(keyMaterial(input));
  }
  return keys;
}

/** True when an entry is older than the TTL and must not be served. */
export function isStale(entry: AnswerCacheEntry, now: number = Date.now()): boolean {
  // A `savedAt` in the future means a clock change; treat it as unusable rather
  // than as valid forever.
  return entry.savedAt > now || now - entry.savedAt > CACHE_TTL_MS;
}

/**
 * Cached drafts for the given keys, keyed by `tempId`.
 *
 * Fails soft in every direction: a storage error, a stale entry, or a stored
 * record that no longer validates all mean "no hit, generate it" rather than an
 * error the user sees. The validator runs on the way out because this is the
 * same boundary the UI trusts for a fresh answer — stored data is not more
 * trustworthy than model output, only older.
 */
export async function readCachedAnswers(
  keys: Record<string, string>,
): Promise<Record<string, GeneratedAnswer>> {
  const tempIds = Object.keys(keys);
  if (tempIds.length === 0) return {};

  let store: AnswerCacheStore;
  try {
    store = await cacheItem.getValue();
  } catch (error) {
    console.warn('[job-copilot] could not read the answer cache', error);
    return {};
  }

  const now = Date.now();
  const hits: Record<string, GeneratedAnswer> = {};
  for (const tempId of tempIds) {
    const entry = store[keys[tempId]!];
    if (entry === undefined || isStale(entry, now)) continue;
    try {
      const [validated] = validateGeneratedAnswers([{ ...entry.answer, tempId }]);
      if (validated !== undefined) hits[tempId] = validated;
    } catch (error) {
      console.warn('[job-copilot] discarding an unreadable cache entry', error);
    }
  }
  return hits;
}

/** Drop expired entries, then the oldest, until the store fits its cap. */
function evict(store: AnswerCacheStore, now: number): AnswerCacheStore {
  const live = Object.entries(store).filter(([, entry]) => !isStale(entry, now));
  if (live.length <= MAX_CACHE_ENTRIES) return Object.fromEntries(live);
  return Object.fromEntries(
    live.sort(([, a], [, b]) => a.savedAt - b.savedAt).slice(live.length - MAX_CACHE_ENTRIES),
  );
}

/**
 * Store freshly generated drafts under their keys.
 *
 * Never throws: the answers are already in hand and on their way to the panel,
 * so a storage failure here must cost a future cache hit and nothing more.
 * Answers whose field had no key (see {@link answerCacheKeys}) are skipped.
 */
export async function writeCachedAnswers(
  keys: Record<string, string>,
  answers: GeneratedAnswer[],
): Promise<void> {
  const writable = answers.filter((answer) => keys[answer.tempId] !== undefined);
  if (writable.length === 0) return;

  try {
    const now = Date.now();
    const store = { ...(await cacheItem.getValue()) };
    for (const { tempId, ...answer } of writable) {
      store[keys[tempId]!] = { answer, savedAt: now };
    }
    await cacheItem.setValue(evict(store, now));
  } catch (error) {
    console.warn('[job-copilot] could not write the answer cache', error);
  }
}

/** Forget every cached draft. Costs a re-generation and nothing else. */
export async function clearAnswerCache(): Promise<void> {
  await cacheItem.setValue({});
}

/** How many drafts are cached right now. For the options page and for tests. */
export async function countCachedAnswers(): Promise<number> {
  return Object.keys(await cacheItem.getValue()).length;
}
