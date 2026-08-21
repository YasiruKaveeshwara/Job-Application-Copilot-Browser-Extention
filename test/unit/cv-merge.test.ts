import { describe, it, expect } from 'vitest';
import { emptyProfile } from '../../lib/storage';
import { MOCK_EXTRACTED_CV } from '../../lib/extractor/mock-extractor';
import {
  applyReview,
  blockedItems,
  buildReviewItems,
  canAccept,
  discardItem,
  fieldValue,
  setCategoryAccepted,
  setChoiceValue,
  setFieldValue,
  setItemAccepted,
} from '../../lib/extractor/merge';
import type { ReviewItem } from '../../lib/extractor/merge';
import type { ExtractedProfileData, ProfileData } from '../../lib/types';

// The review model, which is where the feature's promise lives: nothing reaches
// the profile except through applyReview, and applyReview only copies values out
// of items the user ticked.

function filledProfile(): ProfileData {
  return {
    ...emptyProfile(),
    personal: {
      name: 'Ada Lovelace',
      email: '',
      phone: '',
      links: { github: 'https://github.com/ada' },
    },
    education: [{ institution: 'Analytical University', program: 'Mathematics', dates: '1840' }],
    workHistory: [
      { company: 'Engine Works', role: 'Analyst', dates: '1843', bullets: ['Wrote an algorithm'] },
    ],
    projects: [
      {
        name: 'Note G',
        description: 'Bernoulli numbers',
        individualOrGroup: 'individual',
        techStack: ['Analytical Engine'],
        narrativeFragments: ['Designed a looping computation'],
      },
    ],
    skills: ['Mathematics'],
    standardAnswers: [{ questionPattern: 'why us', answerText: 'Pioneering work' }],
    resumeVariants: [{ label: 'default', fileRef: 'resume.pdf' }],
    stylePreferences: { tone: 'formal', avoid: ['buzzwords'], length: 'concise' },
  };
}

function byId(items: ReviewItem[], id: string): ReviewItem {
  const item = items.find((candidate) => candidate.id === id);
  if (item === undefined) throw new Error(`No review item ${id}. Got: ${items.map((i) => i.id)}`);
  return item;
}

function acceptAll(items: ReviewItem[]): ReviewItem[] {
  return items.map((item) =>
    item.category === 'projects'
      ? { ...item, accepted: true, choice: { ...item.choice, value: 'individual' } }
      : { ...item, accepted: true },
  );
}

describe('buildReviewItems — an empty profile', () => {
  const items = buildReviewItems(emptyProfile(), MOCK_EXTRACTED_CV);

  it('offers every extracted value, grouped by category', () => {
    const categories = new Set(items.map((item) => item.category));
    expect([...categories]).toEqual(['personal', 'education', 'workHistory', 'projects', 'skills']);
    expect(items.filter((item) => item.category === 'skills')).toHaveLength(
      MOCK_EXTRACTED_CV.skills!.length,
    );
  });

  it('marks everything New and accepted by default: nothing is being replaced', () => {
    for (const item of items) {
      expect(item.status).toBe('new');
      expect(item.accepted).toBe(true);
      expect(item.existing).toBeUndefined();
    }
  });

  it('leaves out a value the CV did not state', () => {
    // The canned CV has no portfolio link.
    expect(items.some((item) => item.id === 'personal:portfolio')).toBe(false);
  });

  it('carries the extracted values as editable fields', () => {
    expect(fieldValue(byId(items, 'personal:name'), 'value')).toBe('Mock Candidate');
    const work = byId(items, 'workHistory:0');
    expect(fieldValue(work, 'company')).toBe('Northwind Traders');
    // Bullets are edited as text, one per line.
    expect(fieldValue(work, 'bullets').split('\n')).toHaveLength(2);
    expect(fieldValue(byId(items, 'projects:0'), 'techStack')).toBe('Rust, SQLite');
  });

  it('asks per project whether it was solo or a team effort, with nothing pre-selected', () => {
    const project = byId(items, 'projects:0');
    if (project.category !== 'projects') throw new Error('expected a project item');
    expect(project.choice.value).toBeUndefined();
    expect(project.choice.options.map((option) => option.value)).toEqual(['individual', 'group']);
    // So it cannot be saved on the default-accepted path without an answer.
    expect(canAccept(project)).toBe(false);
    expect(blockedItems(items).map((item) => item.id)).toEqual(['projects:0', 'projects:1']);
  });
});

describe('buildReviewItems — a profile with content already in it', () => {
  const profile = filledProfile();
  const items = buildReviewItems(profile, MOCK_EXTRACTED_CV);

  it('marks a personal field that already has a value as a proposed change, unticked', () => {
    const name = byId(items, 'personal:name');
    expect(name.status).toBe('change');
    expect(name.accepted).toBe(false);
    expect(name.existing).toBe('Ada Lovelace');
  });

  it('still marks an empty personal field as New and accepted', () => {
    const email = byId(items, 'personal:email');
    expect(email.status).toBe('new');
    expect(email.accepted).toBe(true);
  });

  it('marks additions to a section that has manual content as proposed changes', () => {
    // The specification's overwrite check: a section the user filled in by hand
    // must not be quietly added to, let alone replaced.
    for (const id of ['education:0', 'workHistory:0', 'projects:0', 'skills:0']) {
      const item = byId(items, id);
      expect(item.status).toBe('change');
      expect(item.accepted).toBe(false);
      expect(item.existing).toBeTruthy();
    }
    expect(byId(items, 'education:0').existing).toContain('Analytical University');
    expect(byId(items, 'workHistory:0').existing).toContain('Engine Works');
    expect(byId(items, 'projects:0').existing).toContain('Note G');
    expect(byId(items, 'skills:0').existing).toContain('Mathematics');
  });

  it('leaves out a value identical to the stored one', () => {
    const profileWithSameName: ProfileData = {
      ...emptyProfile(),
      personal: { name: 'mock candidate', email: '', phone: '', links: {} },
    };
    const built = buildReviewItems(profileWithSameName, MOCK_EXTRACTED_CV);
    expect(built.some((item) => item.id === 'personal:name')).toBe(false);
  });

  it('leaves out entries and skills the profile already holds, so a re-import is empty', () => {
    const alreadyImported = applyReview(emptyProfile(), acceptAll(items));
    expect(buildReviewItems(alreadyImported, MOCK_EXTRACTED_CV)).toEqual([]);
  });

  it('leaves out a skill it holds under different capitalisation', () => {
    const profileWithSkill: ProfileData = { ...emptyProfile(), skills: ['typescript'] };
    const built = buildReviewItems(profileWithSkill, { skills: ['TypeScript', 'Rust'] });
    expect(built.map((item) => item.title)).toEqual(['Rust']);
  });

  it('drops a row too blank to mean anything', () => {
    const noisy: ExtractedProfileData = {
      education: [{ institution: '', program: '', dates: '2020' }],
      workHistory: [{ company: '', role: '', dates: '', bullets: [] }],
      projectsRaw: [{ name: '', description: 'Something', techStack: [] }],
      skills: [' '],
    };
    expect(buildReviewItems(emptyProfile(), noisy)).toEqual([]);
  });

  it('produces nothing at all from an empty extraction', () => {
    expect(buildReviewItems(profile, {})).toEqual([]);
  });
});

describe('editing the review list', () => {
  const items = buildReviewItems(emptyProfile(), MOCK_EXTRACTED_CV);

  it('ticks and unticks one item without touching the others', () => {
    const updated = setItemAccepted(items, 'personal:name', false);
    expect(byId(updated, 'personal:name').accepted).toBe(false);
    expect(byId(updated, 'personal:email').accepted).toBe(true);
    // And the input list is untouched, so React state updates stay predictable.
    expect(byId(items, 'personal:name').accepted).toBe(true);
  });

  it('ticks a whole category at once', () => {
    const none = setCategoryAccepted(items, 'skills', false);
    expect(none.filter((item) => item.category === 'skills' && item.accepted)).toEqual([]);
    expect(byId(none, 'personal:name').accepted).toBe(true);
  });

  it('edits a field in place', () => {
    const updated = setFieldValue(items, 'personal:email', 'value', 'edited@example.com');
    expect(fieldValue(byId(updated, 'personal:email'), 'value')).toBe('edited@example.com');
    expect(fieldValue(byId(items, 'personal:email'), 'value')).toBe('mock.candidate@example.com');
  });

  it('answers a project question', () => {
    const updated = setChoiceValue(items, 'projects:0', 'group');
    const project = byId(updated, 'projects:0');
    if (project.category !== 'projects') throw new Error('expected a project item');
    expect(project.choice.value).toBe('group');
    expect(canAccept(project)).toBe(true);
    expect(blockedItems(updated).map((item) => item.id)).toEqual(['projects:1']);
  });

  it('discards an item entirely, which is not the same as unticking it', () => {
    const updated = discardItem(items, 'skills:0');
    expect(updated.some((item) => item.id === 'skills:0')).toBe(false);
    expect(updated).toHaveLength(items.length - 1);
  });

  it('refuses to accept an item whose anchor field was emptied', () => {
    const updated = setFieldValue(items, 'education:0', 'institution', '  ');
    expect(canAccept(byId(updated, 'education:0'))).toBe(false);
    expect(blockedItems(updated).some((item) => item.id === 'education:0')).toBe(true);
  });
});

describe('applyReview', () => {
  it('saves nothing when nothing is ticked', () => {
    const profile = filledProfile();
    const items = buildReviewItems(profile, MOCK_EXTRACTED_CV).map((item) => ({
      ...item,
      accepted: false,
    }));
    expect(applyReview(profile, items)).toEqual(profile);
  });

  it('writes only the ticked items', () => {
    const profile = emptyProfile();
    let items = buildReviewItems(profile, MOCK_EXTRACTED_CV);
    items = items.map((item) => ({ ...item, accepted: item.id === 'personal:email' }));

    const merged = applyReview(profile, items);
    expect(merged.personal.email).toBe('mock.candidate@example.com');
    expect(merged.personal.name).toBe('');
    expect(merged.education).toEqual([]);
    expect(merged.skills).toEqual([]);
  });

  it('writes an edited value, not the extracted one', () => {
    const items = setFieldValue(
      buildReviewItems(emptyProfile(), MOCK_EXTRACTED_CV),
      'personal:name',
      'value',
      'Corrected Name',
    ).map((item) => ({ ...item, accepted: item.id === 'personal:name' }));
    expect(applyReview(emptyProfile(), items).personal.name).toBe('Corrected Name');
  });

  it('appends list entries rather than replacing what is there', () => {
    const profile = filledProfile();
    const merged = applyReview(profile, acceptAll(buildReviewItems(profile, MOCK_EXTRACTED_CV)));

    expect(merged.education[0]).toEqual(profile.education[0]);
    expect(merged.education).toHaveLength(1 + MOCK_EXTRACTED_CV.education!.length);
    expect(merged.workHistory[0]).toEqual(profile.workHistory[0]);
    expect(merged.projects[0]).toEqual(profile.projects[0]);
    expect(merged.skills[0]).toBe('Mathematics');
  });

  it('splits bullets by line and tech stacks by comma', () => {
    const items = acceptAll(buildReviewItems(emptyProfile(), MOCK_EXTRACTED_CV));
    const merged = applyReview(emptyProfile(), items);

    expect(merged.workHistory[0]!.bullets).toEqual(MOCK_EXTRACTED_CV.workHistory![0]!.bullets);
    expect(merged.projects[0]!.techStack).toEqual(['Rust', 'SQLite']);
  });

  it('saves the per-project answer the user gave, and no narrative fragments', () => {
    let items = buildReviewItems(emptyProfile(), MOCK_EXTRACTED_CV);
    items = setChoiceValue(items, 'projects:0', 'group');
    items = setChoiceValue(items, 'projects:1', 'individual');
    const merged = applyReview(emptyProfile(), items);

    expect(merged.projects.map((project) => project.individualOrGroup)).toEqual([
      'group',
      'individual',
    ]);
    // Empty rather than invented: the CV cannot say how the user tells the story.
    for (const project of merged.projects) expect(project.narrativeFragments).toEqual([]);
  });

  it('never touches the sections a CV may not fill', () => {
    const profile = filledProfile();
    const merged = applyReview(profile, acceptAll(buildReviewItems(profile, MOCK_EXTRACTED_CV)));

    expect(merged.standardAnswers).toEqual(profile.standardAnswers);
    expect(merged.resumeVariants).toEqual(profile.resumeVariants);
    expect(merged.stylePreferences).toEqual(profile.stylePreferences);
    expect(merged.projects[0]!.narrativeFragments).toEqual(['Designed a looping computation']);
  });

  it('does not modify the profile it was given', () => {
    const profile = filledProfile();
    const before = structuredClone(profile);
    applyReview(profile, acceptAll(buildReviewItems(profile, MOCK_EXTRACTED_CV)));
    expect(profile).toEqual(before);
  });

  it('does not save the same skill twice when two items were edited to match', () => {
    let items = buildReviewItems(emptyProfile(), { skills: ['Rust', 'rust '] });
    items = items.map((item) => ({ ...item, accepted: true }));
    expect(applyReview(emptyProfile(), items).skills).toEqual(['Rust']);
  });

  it('throws rather than silently skipping a ticked item that is incomplete', () => {
    // Unreachable from the UI, which keeps Confirm disabled while blockedItems()
    // is non-empty — so if it happens, an error is the honest outcome.
    const items = buildReviewItems(emptyProfile(), MOCK_EXTRACTED_CV);
    expect(() => applyReview(emptyProfile(), items)).toThrow(/incomplete/);
  });
});
