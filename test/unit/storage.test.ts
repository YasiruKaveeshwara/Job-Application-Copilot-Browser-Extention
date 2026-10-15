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
  getAvailableModels,
  saveAvailableModels,
  getPromptSettings,
  savePromptSettings,
} from '../../lib/storage';
import type { ProfileData, ModelChoice } from '../../lib/types';
import { DEFAULT_PROMPT_SETTINGS, PROMPT_FIELDS } from '../../lib/prompt-settings';

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
    skills: ['Mathematics', 'Analytical Engine'],
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
    expect(readBack.skills).toEqual(data.skills);
    expect(readBack.standardAnswers).toEqual(data.standardAnswers);
    expect(readBack.stylePreferences).toEqual(data.stylePreferences);
  });

  it('reads a profile stored before skills existed as an empty list, never undefined', async () => {
    // A v1 record: written by a build that had no `skills` section at all. The
    // v1 → v2 migration rewrites these on extension update, but a read must not
    // depend on that having happened — the options page maps over every section.
    const v1: Record<string, unknown> = { ...sampleProfile() };
    delete v1.skills;
    await fakeBrowser.storage.local.set({ profile: v1 });

    const readBack = await getProfile();
    expect(readBack.skills).toEqual([]);
    // And nothing else was disturbed on the way.
    expect(readBack.personal).toEqual(sampleProfile().personal);
    expect(readBack.workHistory).toEqual(sampleProfile().workHistory);
  });
});

describe('settings storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns no key or selected model on a fresh install', async () => {
    const settings = await getSettings();
    expect(settings).toEqual(defaultSettings());
    expect(settings.apiKey).toBe('');
    expect(settings.modelId).toBe('');
  });

  it('saves then reads back the key and model', async () => {
    await saveSettings({ apiKey: 'AIza-example', modelId: 'api-returned-model' });
    expect(await getSettings()).toEqual({ apiKey: 'AIza-example', modelId: 'api-returned-model' });
  });

  it('preserves an empty model ID until models are discovered', async () => {
    await saveSettings({ apiKey: 'AIza-example', modelId: '' });
    const settings = await getSettings();
    expect(settings.modelId).toBe('');
    expect(settings.apiKey).toBe('AIza-example');
  });

  it('keeps settings separate from the profile', async () => {
    await saveSettings({ apiKey: 'AIza-example', modelId: 'api-returned-model' });
    // Saving a profile must not disturb the key, and vice versa.
    await saveProfile(sampleProfile());
    expect((await getSettings()).apiKey).toBe('AIza-example');
    expect((await getProfile()).personal.name).toBe('Ada Lovelace');
  });
});

describe('available models storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns no models until the API key has been queried', async () => {
    const models = await getAvailableModels();
    expect(models).toEqual([]);
  });

  it('saves then reads back custom available models', async () => {
    const customModels: ModelChoice[] = [
      { id: 'gemini-custom-1', label: 'Custom Gemini 1' },
      { id: 'gemini-custom-2', label: 'Custom Gemini 2' },
    ];
    await saveAvailableModels(customModels);
    expect(await getAvailableModels()).toEqual(customModels);
  });
});

describe('editable prompt storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns the seeded prompts on a fresh install', async () => {
    expect(await getPromptSettings()).toEqual(DEFAULT_PROMPT_SETTINGS);
  });

  it('exposes the answer revision seed in the editable prompt catalog', () => {
    expect(PROMPT_FIELDS).toContainEqual(
      expect.objectContaining({
        id: 'answerRevisionSystem',
        section: 'Answer revision',
      }),
    );
  });

  it('persists all edited prompt text', async () => {
    const edited = {
      ...DEFAULT_PROMPT_SETTINGS,
      answerDraftingSystem: 'My custom answer instructions',
      answerRevisionSystem: 'My custom answer revision instructions',
    };
    await savePromptSettings(edited);
    expect(await getPromptSettings()).toEqual(edited);
  });

  it('fills missing saved prompt fields with their default seed', async () => {
    await fakeBrowser.storage.local.set({
      promptSettings: { answerDraftingSystem: 'My custom answer instructions' },
    });
    expect(await getPromptSettings()).toEqual({
      ...DEFAULT_PROMPT_SETTINGS,
      answerDraftingSystem: 'My custom answer instructions',
    });
  });
});
