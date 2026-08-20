import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getProfile,
  saveProfile,
  updateProfileSection,
  emptyProfile,
  getSettings,
  saveSettings,
  defaultSettings,
  DEFAULT_MODEL_ID,
  CHEAP_MODEL_ID,
} from '../../lib/storage';
import type { ProfileData } from '../../lib/types';

function sampleProfile(): ProfileData {
  return {
    personal: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone: '555-0100',
      links: { github: 'https://github.com/ada' },
    },
    education: [{ institution: 'Analytical University', program: 'Mathematics', dates: '1840' }],
    workHistory: [
      {
        company: 'Engine Works',
        role: 'Analyst',
        dates: '1843',
        bullets: ['Wrote the first algorithm'],
      },
    ],
    projects: [
      {
        name: 'Note G',
        description: 'Bernoulli numbers on the Analytical Engine',
        individualOrGroup: 'individual',
        techStack: ['Analytical Engine'],
        narrativeFragments: ['Designed a looping computation'],
      },
    ],
    standardAnswers: [{ questionPattern: 'why us', answerText: 'Pioneering work' }],
    resumeVariants: [{ label: 'default', fileRef: 'resume.pdf' }],
    stylePreferences: { tone: 'formal', avoid: ['buzzwords'], length: 'concise' },
  };
}

describe('storage', () => {
  beforeEach(() => {
    // Reset the in-memory extension storage between tests.
    fakeBrowser.reset();
  });

  it('returns the empty default when nothing has been saved', async () => {
    const profile = await getProfile();
    expect(profile).toEqual(emptyProfile());
    // Must be the default shape, never undefined.
    expect(profile).not.toBeUndefined();
  });

  it('saves then reads back the same data', async () => {
    const data = sampleProfile();
    await saveProfile(data);
    const readBack = await getProfile();
    expect(readBack).toEqual(data);
  });

  it('updates only the targeted section via updateProfileSection', async () => {
    const data = sampleProfile();
    await saveProfile(data);

    const newProjects: ProfileData['projects'] = [
      {
        name: 'Second Project',
        description: 'A different thing',
        individualOrGroup: 'group',
        techStack: ['TypeScript'],
        narrativeFragments: ['Collaborated with a team'],
      },
    ];
    await updateProfileSection('projects', newProjects);

    const readBack = await getProfile();
    // Targeted section changed...
    expect(readBack.projects).toEqual(newProjects);
    // ...and every other section is untouched.
    expect(readBack.personal).toEqual(data.personal);
    expect(readBack.workHistory).toEqual(data.workHistory);
    expect(readBack.standardAnswers).toEqual(data.standardAnswers);
    expect(readBack.stylePreferences).toEqual(data.stylePreferences);
  });
});

describe('settings storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns no key and the default model on a fresh install', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(defaultSettings());
    expect(settings.apiKey).toBe('');
    expect(settings.modelId).toBe(DEFAULT_MODEL_ID);
  });

  it('saves then reads back the key and model', async () => {
    await saveSettings({ apiKey: 'AIza-example', modelId: CHEAP_MODEL_ID });
    expect(await getSettings()).toEqual({ apiKey: 'AIza-example', modelId: CHEAP_MODEL_ID });
  });

  it('falls back to the default model if a stored record has an empty model ID', async () => {
    await saveSettings({ apiKey: 'AIza-example', modelId: '' });
    const settings = await getSettings();
    expect(settings.modelId).toBe(DEFAULT_MODEL_ID);
    expect(settings.apiKey).toBe('AIza-example');
  });

  it('keeps settings separate from the profile', async () => {
    await saveSettings({ apiKey: 'AIza-example', modelId: DEFAULT_MODEL_ID });
    // Saving a profile must not disturb the key, and vice versa.
    await saveProfile(sampleProfile());
    expect((await getSettings()).apiKey).toBe('AIza-example');
    expect((await getProfile()).personal.name).toBe('Ada Lovelace');
  });
});
