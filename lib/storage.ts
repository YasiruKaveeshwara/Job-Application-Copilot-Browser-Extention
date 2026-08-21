import { storage } from '#imports';
import type { ProfileData, Settings } from './types';

// Local-only persistence for the user's profile. The `local:` prefix keeps the
// data on-device (never synced to the browser account), per the build guide,
// Phase 3.
const PROFILE_KEY = 'local:profile' as const;
/** v2 added `skills`, for CV import. See `migrations` below. */
const PROFILE_VERSION = 2;

/**
 * A sensible empty profile so the UI and downstream logic never crash on first
 * run, before the user has entered anything.
 */
export function emptyProfile(): ProfileData {
  return {
    personal: { name: '', email: '', phone: '', links: {} },
    education: [],
    workHistory: [],
    projects: [],
    skills: [],
    standardAnswers: [],
    resumeVariants: [],
    stylePreferences: { tone: '', avoid: [], length: 'standard' },
  };
}

const profileItem = storage.defineItem<ProfileData>(PROFILE_KEY, {
  version: PROFILE_VERSION,
  fallback: emptyProfile(),
  migrations: {
    // v1 → v2: `skills` did not exist. Nothing to derive it from, so it starts
    // empty; CV import or the manual form fills it.
    2: (old: ProfileData): ProfileData => ({ ...emptyProfile(), ...old, skills: [] }),
  },
});

/**
 * Read the stored profile, or the empty default if nothing is saved yet.
 *
 * Every section is guaranteed present and of the right container type, whatever
 * is actually on disk. That matters beyond tidiness: a v1 record has no `skills`
 * key at all, and the UI maps over these arrays — one `undefined` is a blank
 * options page. The migration above rewrites old records properly, but it runs on
 * extension update, so this does not depend on it having run.
 */
export async function getProfile(): Promise<ProfileData> {
  const stored = await profileItem.getValue();
  const empty = emptyProfile();
  return {
    ...empty,
    ...stored,
    personal: { ...empty.personal, ...stored.personal },
    education: asArray(stored.education),
    workHistory: asArray(stored.workHistory),
    projects: asArray(stored.projects),
    skills: asArray(stored.skills),
    standardAnswers: asArray(stored.standardAnswers),
    resumeVariants: asArray(stored.resumeVariants),
    stylePreferences: { ...empty.stylePreferences, ...stored.stylePreferences },
  };
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

/** Overwrite the entire stored profile. */
export async function saveProfile(data: ProfileData): Promise<void> {
  await profileItem.setValue(data);
}

/** Update a single top-level section without touching the others. */
export async function updateProfileSection<K extends keyof ProfileData>(
  key: K,
  value: ProfileData[K],
): Promise<void> {
  const current = await profileItem.getValue();
  await profileItem.setValue({ ...current, [key]: value });
}

// ---------------------------------------------------------------------------
// Settings (Gemini API key + model ID)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'local:settings' as const;
const SETTINGS_VERSION = 1;

/**
 * Default generation model. Deliberately a constant read through settings rather
 * than a literal at the call site, so it can be swapped for a cheaper/faster one
 * without touching the generator.
 */
export const DEFAULT_MODEL_ID = 'gemini-3.7-flash';

/** The cheaper, faster alternative. Same request shape, lower cost per page. */
export const CHEAP_MODEL_ID = 'gemini-3.5-flash-lite';

/** Models offered in the options page picker. Any other ID can still be stored. */
export const MODEL_CHOICES: { id: string; label: string }[] = [
  { id: DEFAULT_MODEL_ID, label: 'Gemini 3.7 Flash — best drafts (default)' },
  { id: CHEAP_MODEL_ID, label: 'Gemini 3.5 Flash Lite — fastest and cheapest' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — middle ground' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — older stable' },
];

/** Settings for a fresh install: no key yet, default model. */
export function defaultSettings(): Settings {
  return { apiKey: '', modelId: DEFAULT_MODEL_ID };
}

const settingsItem = storage.defineItem<Settings>(SETTINGS_KEY, {
  version: SETTINGS_VERSION,
  fallback: defaultSettings(),
});

/** Read the stored settings, falling back to defaults on a fresh install. */
export async function getSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  // Guard against a partially-written record from an older build: an empty model
  // ID would produce an unusable request URL.
  return { ...defaultSettings(), ...stored, modelId: stored.modelId || DEFAULT_MODEL_ID };
}

export async function saveSettings(value: Settings): Promise<void> {
  await settingsItem.setValue(value);
}
