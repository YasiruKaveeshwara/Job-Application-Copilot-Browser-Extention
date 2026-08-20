import { storage } from '#imports';
import type { ProfileData } from './types';

// Local-only persistence for the user's profile. The `local:` prefix keeps the
// data on-device (never synced to the browser account), per the build guide,
// Phase 3.
const PROFILE_KEY = 'local:profile' as const;
const PROFILE_VERSION = 1;

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
    standardAnswers: [],
    resumeVariants: [],
    stylePreferences: { tone: '', avoid: [], length: 'standard' },
  };
}

const profileItem = storage.defineItem<ProfileData>(PROFILE_KEY, {
  version: PROFILE_VERSION,
  fallback: emptyProfile(),
});

/** Read the stored profile, or the empty default if nothing is saved yet. */
export async function getProfile(): Promise<ProfileData> {
  return profileItem.getValue();
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
