import type { ExtractedProfileData, ProfileData } from '../types';

// The import model: extracted values, automatic-save eligibility, and project
// details that need a user-provided solo/team choice.
//
// Pure functions over plain data, in a .ts module rather than inside the React
// section, for the reason the build guide gives (section 0, rule 6) and because
// this is where the write boundary is kept: values reach storage only through
// `applyReview`. The automatic-save path accepts eligible extracted items;
// projects require the user's solo/team choice before they can be accepted.
//
// Two rules from the specification are structural here rather than advisory:
//
//   * New extracted values are saved automatically. A differing personal value
//     replaces the current value; new list entries append only when not already
//     present. Identical values and entries are ignored.
//   * Five things never come from a CV: a project's `individualOrGroup`, and all
//     of `narrativeFragments`, `standardAnswers`, `stylePreferences`,
//     `resumeVariants`. The first is asked as a per-project question because the
//     type needs an answer and the document cannot give one; the rest are copied
//     through from the existing profile untouched.

export type ReviewCategory = 'personal' | 'education' | 'workHistory' | 'projects' | 'skills';

export const CATEGORY_ORDER: ReviewCategory[] = [
  'personal',
  'education',
  'workHistory',
  'projects',
  'skills',
];

export const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  personal: 'Personal',
  education: 'Education',
  workHistory: 'Work history',
  projects: 'Projects',
  skills: 'Skills',
};

/** Which single value on `personal` an item writes to, once accepted. */
export type PersonalTarget = 'name' | 'email' | 'phone' | 'github' | 'linkedin' | 'portfolio';

/** One editable value inside a review item. */
export interface ReviewField {
  key: string;
  label: string;
  value: string;
  /** Rendered as a textarea. Bullets and descriptions run long. */
  multiline?: boolean;
}

/**
 * A question the document cannot answer, asked per item.
 *
 * Only projects have one today (`individualOrGroup`). `value` stays undefined
 * until the user picks, and an item with an unanswered question cannot be
 * accepted — see {@link canAccept}.
 */
export interface ReviewChoice {
  label: string;
  hint: string;
  options: { value: string; label: string }[];
  value?: string;
}

interface ReviewItemBase {
  id: string;
  /** Heading for the card, derived from the extracted values. */
  title: string;
  status: 'new' | 'change';
  accepted: boolean;
  fields: ReviewField[];
  /** What the profile already holds. Present exactly when status is 'change'. */
  existing?: string;
}

export type ReviewItem =
  | (ReviewItemBase & { category: 'personal'; target: PersonalTarget })
  | (ReviewItemBase & { category: 'education' })
  | (ReviewItemBase & { category: 'workHistory' })
  | (ReviewItemBase & { category: 'projects'; choice: ReviewChoice })
  | (ReviewItemBase & { category: 'skills' });

/** The field that has to be filled in for an item to mean anything. */
const ANCHOR: Record<ReviewCategory, string> = {
  personal: 'value',
  education: 'institution',
  workHistory: 'company',
  projects: 'name',
  skills: 'value',
};

// ---------------------------------------------------------------------------
// Reading items out of an item's fields
// ---------------------------------------------------------------------------

/** A field's current value, or `''` if the item has no such field. */
export function fieldValue(item: ReviewItem, key: string): string {
  return item.fields.find((field) => field.key === key)?.value.trim() ?? '';
}

/** Split a multiline field into non-blank lines (bullets are edited as text). */
function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Split a comma-separated field (tech stacks are edited as one line). */
function commaList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Whether an item is complete enough to accept: it names the thing it describes,
 * and any question the document could not answer has been answered.
 */
export function canAccept(item: ReviewItem): boolean {
  if (fieldValue(item, ANCHOR[item.category]).length === 0) return false;
  if (item.category === 'projects' && item.choice.value === undefined) return false;
  return true;
}

/** Ticked items that cannot be saved yet. The Confirm button waits on these. */
export function blockedItems(items: ReviewItem[]): ReviewItem[] {
  return items.filter((item) => item.accepted && !canAccept(item));
}

export function acceptedItems(items: ReviewItem[]): ReviewItem[] {
  return items.filter((item) => item.accepted);
}

// ---------------------------------------------------------------------------
// Building the review list
// ---------------------------------------------------------------------------

const PERSONAL_FIELDS: { target: PersonalTarget; label: string }[] = [
  { target: 'name', label: 'Full name' },
  { target: 'email', label: 'Email' },
  { target: 'phone', label: 'Phone' },
  { target: 'github', label: 'GitHub' },
  { target: 'linkedin', label: 'LinkedIn' },
  { target: 'portfolio', label: 'Portfolio' },
];

function personalValue(personal: ProfileData['personal'], target: PersonalTarget): string {
  switch (target) {
    case 'name':
      return personal.name;
    case 'email':
      return personal.email;
    case 'phone':
      return personal.phone;
    default:
      return personal.links[target] ?? '';
  }
}

function extractedPersonalValue(
  personal: NonNullable<ExtractedProfileData['personal']>,
  target: PersonalTarget,
): string {
  switch (target) {
    case 'name':
      return personal.name ?? '';
    case 'email':
      return personal.email ?? '';
    case 'phone':
      return personal.phone ?? '';
    default:
      return personal.links?.[target] ?? '';
  }
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Turn an extraction into structured profile items.
 *
 * Anything already in the profile is left out rather than shown as a change to
 * itself: a value identical to the stored one, a school or employer or project
 * already listed, a skill already held. Re-importing the same CV therefore
 * produces an empty review rather than a duplicated profile.
 */
export function buildReviewItems(
  profile: ProfileData,
  extracted: ExtractedProfileData,
): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const { target, label } of PERSONAL_FIELDS) {
    const value = extractedPersonalValue(extracted.personal ?? {}, target);
    if (value.length === 0) continue;
    const existing = personalValue(profile.personal, target).trim();
    if (same(existing, value)) continue;
    items.push({
      id: `personal:${target}`,
      category: 'personal',
      target,
      title: label,
      status: existing.length > 0 ? 'change' : 'new',
      accepted: existing.length === 0,
      ...(existing.length > 0 ? { existing } : {}),
      fields: [{ key: 'value', label, value }],
    });
  }

  const educationHasContent = profile.education.length > 0;
  const educationSummary = profile.education
    .map((entry) => [entry.institution, entry.program].filter(Boolean).join(' — '))
    .filter((line) => line.length > 0)
    .join('; ');
  (extracted.education ?? []).forEach((entry, index) => {
    if (entry.institution.trim().length === 0 && entry.program.trim().length === 0) return;
    const duplicate = profile.education.some(
      (existing) =>
        same(existing.institution, entry.institution) && same(existing.program, entry.program),
    );
    if (duplicate) return;
    items.push({
      id: `education:${index}`,
      category: 'education',
      title: entry.institution || entry.program || 'Education entry',
      status: educationHasContent ? 'change' : 'new',
      accepted: !educationHasContent,
      ...(educationHasContent ? { existing: educationSummary || 'entries already saved' } : {}),
      fields: [
        { key: 'institution', label: 'Institution', value: entry.institution },
        { key: 'program', label: 'Program', value: entry.program },
        { key: 'dates', label: 'Dates', value: entry.dates },
      ],
    });
  });

  const workHasContent = profile.workHistory.length > 0;
  const workSummary = profile.workHistory
    .map((entry) => [entry.company, entry.role].filter(Boolean).join(' — '))
    .filter((line) => line.length > 0)
    .join('; ');
  (extracted.workHistory ?? []).forEach((entry, index) => {
    if (entry.company.trim().length === 0 && entry.role.trim().length === 0) return;
    const duplicate = profile.workHistory.some(
      (existing) => same(existing.company, entry.company) && same(existing.role, entry.role),
    );
    if (duplicate) return;
    items.push({
      id: `workHistory:${index}`,
      category: 'workHistory',
      title: [entry.company, entry.role].filter(Boolean).join(' — ') || 'Role',
      status: workHasContent ? 'change' : 'new',
      accepted: !workHasContent,
      ...(workHasContent ? { existing: workSummary || 'entries already saved' } : {}),
      fields: [
        { key: 'company', label: 'Company', value: entry.company },
        { key: 'role', label: 'Role', value: entry.role },
        { key: 'dates', label: 'Dates', value: entry.dates },
        {
          key: 'bullets',
          label: 'Bullets (one per line)',
          value: entry.bullets.join('\n'),
          multiline: true,
        },
      ],
    });
  });

  const projectsHaveContent = profile.projects.length > 0;
  const projectSummary = profile.projects
    .map((entry) => entry.name)
    .filter((name) => name.length > 0)
    .join('; ');
  (extracted.projectsRaw ?? []).forEach((entry, index) => {
    if (entry.name.trim().length === 0) return;
    if (profile.projects.some((existing) => same(existing.name, entry.name))) return;
    items.push({
      id: `projects:${index}`,
      category: 'projects',
      title: entry.name,
      status: projectsHaveContent ? 'change' : 'new',
      accepted: !projectsHaveContent,
      ...(projectsHaveContent ? { existing: projectSummary || 'projects already saved' } : {}),
      fields: [
        { key: 'name', label: 'Name', value: entry.name },
        { key: 'description', label: 'Description', value: entry.description, multiline: true },
        {
          key: 'techStack',
          label: 'Tech stack (comma separated)',
          value: entry.techStack.join(', '),
        },
      ],
      choice: {
        label: 'Was this solo or a team project?',
        // The CV was not asked, so there is nothing to pre-select. Leaving it
        // blank until the user says is the point: the alternative is the
        // extension guessing, in a field the specification puts off limits.
        hint: 'Not taken from the CV — pick one to save this project.',
        options: [
          { value: 'individual', label: 'Solo' },
          { value: 'group', label: 'Team' },
        ],
      },
    });
  });

  const skillsHaveContent = profile.skills.length > 0;
  const skillsSummary = profile.skills.join(', ');
  (extracted.skills ?? []).forEach((skill, index) => {
    if (skill.trim().length === 0) return;
    if (profile.skills.some((existing) => same(existing, skill))) return;
    items.push({
      id: `skills:${index}`,
      category: 'skills',
      title: skill,
      status: skillsHaveContent ? 'change' : 'new',
      accepted: !skillsHaveContent,
      ...(skillsHaveContent ? { existing: skillsSummary } : {}),
      fields: [{ key: 'value', label: 'Skill', value: skill }],
    });
  });

  return items;
}

/**
 * Items that can be saved directly from an extraction without inventing a
 * value the CV cannot establish. Project entries are excluded because their
 * required solo/team choice must come from the user.
 */
export function itemsForAutomaticSave(items: ReviewItem[]): ReviewItem[] {
  return items
    .filter((item) => item.category !== 'projects' && canAccept(item))
    .map((item) => ({ ...item, accepted: true }));
}

// ---------------------------------------------------------------------------
// Editing the review list (immutable, so React state updates are plain
// assignments and the logic stays testable outside a component)
// ---------------------------------------------------------------------------

export function setItemAccepted(items: ReviewItem[], id: string, accepted: boolean): ReviewItem[] {
  return items.map((item) => (item.id === id ? { ...item, accepted } : item));
}

/** Tick or untick a whole category at once. Only ever a user's click. */
export function setCategoryAccepted(
  items: ReviewItem[],
  category: ReviewCategory,
  accepted: boolean,
): ReviewItem[] {
  return items.map((item) => (item.category === category ? { ...item, accepted } : item));
}

export function setFieldValue(
  items: ReviewItem[],
  id: string,
  key: string,
  value: string,
): ReviewItem[] {
  return items.map((item) =>
    item.id === id
      ? {
          ...item,
          fields: item.fields.map((field) => (field.key === key ? { ...field, value } : field)),
        }
      : item,
  );
}

export function setChoiceValue(items: ReviewItem[], id: string, value: string): ReviewItem[] {
  return items.map((item) =>
    item.id === id && item.category === 'projects'
      ? { ...item, choice: { ...item.choice, value } }
      : item,
  );
}

/** Drop an item from the review entirely. Discarding is not the same as unticking. */
export function discardItem(items: ReviewItem[], id: string): ReviewItem[] {
  return items.filter((item) => item.id !== id);
}

// ---------------------------------------------------------------------------
// Applying the review
// ---------------------------------------------------------------------------

/**
 * The profile as it would be with every accepted item applied — the only
 * function in the feature that turns extracted data into profile data.
 *
 * Returns a new object; the input is not modified, so a caller can show the
 * result before saving it. Unticked items, and every section the specification
 * puts off limits, are copied through as they were.
 *
 * Throws if an accepted item is not complete ({@link canAccept}). That state is
 * unreachable from the UI, which keeps Confirm disabled while
 * {@link blockedItems} is non-empty — so if it ever happens the honest outcome is
 * an error, not a save that silently leaves an item out.
 */
export function applyReview(profile: ProfileData, items: ReviewItem[]): ProfileData {
  const next: ProfileData = {
    ...profile,
    personal: { ...profile.personal, links: { ...profile.personal.links } },
    education: [...profile.education],
    workHistory: [...profile.workHistory],
    projects: [...profile.projects],
    skills: [...profile.skills],
  };

  for (const item of items) {
    if (!item.accepted) continue;
    if (!canAccept(item)) {
      throw new Error(`Cannot apply "${item.title}": it is incomplete.`);
    }

    switch (item.category) {
      case 'personal': {
        const value = fieldValue(item, 'value');
        if (item.target === 'name' || item.target === 'email' || item.target === 'phone') {
          next.personal[item.target] = value;
        } else {
          next.personal.links[item.target] = value;
        }
        break;
      }
      case 'education':
        next.education.push({
          institution: fieldValue(item, 'institution'),
          program: fieldValue(item, 'program'),
          dates: fieldValue(item, 'dates'),
        });
        break;
      case 'workHistory':
        next.workHistory.push({
          company: fieldValue(item, 'company'),
          role: fieldValue(item, 'role'),
          dates: fieldValue(item, 'dates'),
          bullets: lines(fieldValue(item, 'bullets')),
        });
        break;
      case 'projects':
        next.projects.push({
          name: fieldValue(item, 'name'),
          description: fieldValue(item, 'description'),
          // Non-null because canAccept() above refuses an unanswered choice.
          individualOrGroup: item.choice.value === 'group' ? 'group' : 'individual',
          techStack: commaList(fieldValue(item, 'techStack')),
          // Empty rather than invented: how the user tells this project's story
          // is theirs to write, in the profile form.
          narrativeFragments: [],
        });
        break;
      case 'skills': {
        const skill = fieldValue(item, 'value');
        // Two accepted items can name the same skill after editing; the profile
        // should not end up holding it twice.
        if (!next.skills.some((existing) => same(existing, skill))) next.skills.push(skill);
        break;
      }
    }
  }

  return next;
}
