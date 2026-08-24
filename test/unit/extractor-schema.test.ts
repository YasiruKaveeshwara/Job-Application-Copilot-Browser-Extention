import { describe, it, expect } from 'vitest';
import {
  EXTRACTED_PROFILE_SCHEMA,
  ExtractionSchemaError,
  validateExtractedProfile,
  withoutNulls,
} from '../../lib/extractor/schema';

// The gate the feature's one hard rule is enforced at: five parts of a profile
// must never arrive from a document, so a response containing one has to fail
// rather than be quietly cleaned up.

const wellFormed = {
  personal: {
    name: 'Grace Hopper',
    email: 'grace@example.com',
    phone: '555-0142',
    links: { github: 'https://github.com/grace', linkedin: 'https://linkedin.com/in/grace' },
  },
  education: [{ institution: 'Yale', program: 'PhD Mathematics', dates: '1930 – 1934' }],
  workHistory: [
    {
      company: 'US Navy',
      role: 'Rear Admiral',
      dates: '1943 – 1986',
      bullets: ['Wrote the first compiler.'],
    },
  ],
  projectsRaw: [
    { name: 'COBOL', description: 'A business-oriented language.', techStack: ['FLOW-MATIC'] },
  ],
  skills: ['COBOL', 'Compilers'],
};

describe('extraction schema — what it accepts', () => {
  it('accepts a well-formed extraction unchanged', () => {
    expect(validateExtractedProfile(wellFormed)).toEqual(wellFormed);
  });

  it('accepts an empty object: a CV that stated nothing extractable', () => {
    expect(validateExtractedProfile({})).toEqual({});
  });

  it('accepts a JSON string, including one the model wrapped in a code fence', () => {
    const json = JSON.stringify(wellFormed);
    expect(validateExtractedProfile(json)).toEqual(wellFormed);
    expect(validateExtractedProfile('```json\n' + json + '\n```')).toEqual(wellFormed);
  });

  it('fills the fields a row may honestly omit, rather than failing the import', () => {
    // A degree with no dates, and a job with no bullets, are normal on a CV.
    const parsed = validateExtractedProfile({
      education: [{ institution: 'Open University' }],
      workHistory: [{ company: 'Contoso' }],
      projectsRaw: [{ name: 'Tide' }],
    });
    expect(parsed.education).toEqual([{ institution: 'Open University', program: '', dates: '' }]);
    expect(parsed.workHistory).toEqual([{ company: 'Contoso', role: '', dates: '', bullets: [] }]);
    expect(parsed.projectsRaw).toEqual([{ name: 'Tide', description: '', techStack: [] }]);
  });

  it('trims the whitespace PDF text extraction leaves behind', () => {
    const parsed = validateExtractedProfile({
      personal: { name: '  Grace Hopper \n' },
      skills: [' COBOL  '],
    });
    expect(parsed.personal?.name).toBe('Grace Hopper');
    expect(parsed.skills).toEqual(['COBOL']);
  });

  it('treats null as "not stated", the other way a model says the same thing', () => {
    const parsed = validateExtractedProfile({
      personal: { name: 'Grace Hopper', phone: null },
      education: null,
      skills: ['COBOL', null],
    });
    expect(parsed).toEqual({ personal: { name: 'Grace Hopper' }, skills: ['COBOL'] });
    // The helper is pure and recursive, and leaves everything else alone.
    expect(withoutNulls({ a: [1, null, { b: null, c: 2 }] })).toEqual({ a: [1, { c: 2 }] });
  });
});

describe('extraction schema — the fields a CV may never fill', () => {
  // One per exclusion in the specification. Each must be *rejected*: dropping it
  // silently would make a drifting prompt or a changed model look identical to a
  // correct one.
  const forbidden: [name: string, payload: Record<string, unknown>][] = [
    [
      'individualOrGroup',
      { projectsRaw: [{ name: 'COBOL', description: '', individualOrGroup: 'individual' }] },
    ],
    [
      'narrativeFragments',
      { projectsRaw: [{ name: 'COBOL', description: '', narrativeFragments: ['Led it'] }] },
    ],
    [
      'standardAnswers',
      { standardAnswers: [{ questionPattern: 'why us', answerText: 'Because' }] },
    ],
    ['stylePreferences', { stylePreferences: { tone: 'formal', avoid: [], length: 'concise' } }],
    ['resumeVariants', { resumeVariants: [{ label: 'default', fileRef: 'cv.pdf' }] }],
  ];

  for (const [name, payload] of forbidden) {
    it(`rejects ${name} and says which key it was`, () => {
      expect(() => validateExtractedProfile(payload)).toThrow(ExtractionSchemaError);
      try {
        validateExtractedProfile(payload);
      } catch (error) {
        expect((error as ExtractionSchemaError).message).toContain(name);
      }
    });
  }

  it('rejects a `projects` key, so a drift back to the profile shape is caught', () => {
    // ExtractedProfileData deliberately calls this `projectsRaw`; the two shapes
    // differ by exactly the decisions a document cannot make.
    expect(() => validateExtractedProfile({ projects: [{ name: 'COBOL' }] })).toThrow(/projects/);
  });

  it('rejects any other unrecognized key rather than ignoring it', () => {
    expect(() => validateExtractedProfile({ personal: { salaryExpectation: '100k' } })).toThrow(
      /salaryExpectation/,
    );
  });
});

describe('extraction schema — what it rejects', () => {
  it('rejects a wrong type where a list belongs', () => {
    const error = capture(() => validateExtractedProfile({ skills: 'COBOL, Compilers' }));
    expect(error).toBeInstanceOf(ExtractionSchemaError);
    expect(error.message).toContain('skills');
    expect(error.message).toContain('expected array');
  });

  it('rejects a wrong type where a string belongs', () => {
    const error = capture(() => validateExtractedProfile({ personal: { name: 42 } }));
    expect(error.message).toContain('personal.name');
  });

  it('rejects a wrong type inside a list entry', () => {
    const error = capture(() =>
      validateExtractedProfile({ workHistory: [{ company: 'Contoso', bullets: 'One thing' }] }),
    );
    expect(error.message).toContain('workHistory.0.bullets');
  });

  it('rejects an array where the object belongs', () => {
    expect(() => validateExtractedProfile([wellFormed])).toThrow(ExtractionSchemaError);
  });

  it('rejects prose instead of JSON, as a catchable error', () => {
    const error = capture(() => validateExtractedProfile("Here's what I found in the CV!"));
    expect(error).toBeInstanceOf(ExtractionSchemaError);
    expect(error.message).toContain('not valid JSON');
  });

  it('rejects an empty response', () => {
    expect(() => validateExtractedProfile('   ')).toThrow(/empty/);
  });

  it('reports every problem at once, not just the first', () => {
    const error = capture(() =>
      validateExtractedProfile({ skills: 3, education: 'Yale', resumeVariants: [] }),
    );
    expect((error as ExtractionSchemaError).issues.length).toBeGreaterThan(2);
  });

  it('exposes the schema itself, so a shape can be checked without the wrapper', () => {
    expect(EXTRACTED_PROFILE_SCHEMA.safeParse(wellFormed).success).toBe(true);
    expect(EXTRACTED_PROFILE_SCHEMA.safeParse({ standardAnswers: [] }).success).toBe(false);
  });
});

/** Run a thrower and return what it threw, typed for assertions. */
function capture(run: () => unknown): ExtractionSchemaError {
  try {
    run();
  } catch (error) {
    return error as ExtractionSchemaError;
  }
  throw new Error('Expected validation to throw, but it returned');
}
