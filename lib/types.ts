// Shared cross-module data contracts. Every other module imports these shapes
// rather than redefining them (build guide, Phase 2). Fields may be extended
// later; none of the listed fields should be removed.

export interface ProfileData {
  personal: {
    name: string;
    email: string;
    phone: string;
    links: { github?: string; linkedin?: string; portfolio?: string };
  };
  education: { institution: string; program: string; dates: string }[];
  workHistory: { company: string; role: string; dates: string; bullets: string[] }[];
  projects: {
    name: string;
    description: string;
    individualOrGroup: 'individual' | 'group';
    techStack: string[];
    narrativeFragments: string[];
  }[];
  /**
   * Technologies and capabilities, as short tokens ("TypeScript", "Kubernetes").
   *
   * Added after the original seven sections, for CV import: a CV lists skills
   * plainly and they are worth keeping, but there was nowhere to put them.
   * Stored profiles written before this existed have no `skills` key, which is
   * what the v2 storage migration is for (see lib/storage.ts).
   */
  skills: string[];
  standardAnswers: { questionPattern: string; answerText: string }[];
  resumeVariants: { label: string; fileRef: string }[];
  stylePreferences: { tone: string; avoid: string[]; length: 'concise' | 'standard' | 'detailed' };
}

/**
 * What a model could honestly read off an uploaded CV.
 *
 * Every field is optional: a CV that does not state something must produce an
 * absent key, never a guess. This is deliberately a subset of `ProfileData` —
 * the sections left out are the ones a document cannot tell you:
 *
 * - `individualOrGroup` — whether a project was solo or a team effort is framing
 *   the user decides; the review screen asks them, per project.
 * - `narrativeFragments`, `standardAnswers`, `stylePreferences` — how the user
 *   wants their history told. Manual entry only.
 * - `resumeVariants` — a file reference to a document the extension does not keep.
 *
 * `projectsRaw` is named apart from `ProfileData['projects']` because it is that
 * shape minus those two decisions, so the types cannot be confused for each
 * other or assigned across.
 */
export interface ExtractedProfileData {
  personal?: Partial<ProfileData['personal']>;
  education?: ProfileData['education'];
  workHistory?: ProfileData['workHistory'];
  projectsRaw?: { name: string; description: string; techStack: string[] }[];
  skills?: string[];
}

export interface DetectedField {
  tempId: string;
  resolvedLabel: string;
  labelConfidence: 'structured' | 'proximity' | 'none';
  elementType: string;
  domRef: string;
  currentValue: string;
  surroundingText: string;
}

export interface JobContext {
  rawText: string;
  url: string;
  pageTitle: string;
}

export interface GeneratedAnswer {
  tempId: string;
  classifiedType: string;
  confidence: 'high' | 'low';
  draftAnswer: string;
  /** Set only for deterministic profile matches, which are not AI-revisable. */
  source?: 'profile';
}

/**
 * User-configurable settings for the LLM call (build guide, section 1: the model
 * ID is a setting, never a hardcoded literal).
 *
 * Bring-your-own-key: the key lives in local extension storage on this device
 * only. It is never synced to the browser account and never leaves the machine
 * except in the request to the provider.
 */
export interface Settings {
  apiKey: string;
  modelId: string;
}

/** One model option offered in the model selector. */
export interface ModelChoice {
  id: string;
  label: string;
  description?: string;
}
