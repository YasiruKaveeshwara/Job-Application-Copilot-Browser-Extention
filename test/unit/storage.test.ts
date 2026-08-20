import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getProfile,
  saveProfile,
  updateProfileSection,
  emptyProfile,
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
