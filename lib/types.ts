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
  standardAnswers: { questionPattern: string; answerText: string }[];
  resumeVariants: { label: string; fileRef: string }[];
  stylePreferences: { tone: string; avoid: string[]; length: 'concise' | 'standard' | 'detailed' };
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
}
