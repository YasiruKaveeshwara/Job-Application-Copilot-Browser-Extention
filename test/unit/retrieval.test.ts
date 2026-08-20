import { describe, it, expect, afterEach, vi } from 'vitest';
import { retrieveFragments, DEFAULT_K, MIN_JOB_CONTEXT_MATCHES } from '../../lib/retrieval';
import { emptyProfile } from '../../lib/storage';
import type { DetectedField, JobContext, ProfileData } from '../../lib/types';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    tempId: 'f0',
    resolvedLabel: '',
    labelConfidence: 'structured',
    elementType: 'textarea',
    domRef: 'jac-1',
    currentValue: '',
    surroundingText: '',
    ...overrides,
  };
}

function context(overrides: Partial<JobContext> = {}): JobContext {
  return { rawText: '', url: 'https://jobs.example.com/1', pageTitle: '', ...overrides };
}

/** A profile with two clearly distinct projects, so ranking is unambiguous. */
function profile(): ProfileData {
  return {
    ...emptyProfile(),
    workHistory: [
      {
        company: 'Northwind Retail',
        role: 'Frontend Engineer',
        dates: '2023-2024',
        bullets: [
          'Rebuilt the checkout page in React and cut bounce rate by a fifth',
          'Introduced visual regression testing for the design system',
        ],
      },
      {
        company: 'Harbour Logistics',
        role: 'Platform Engineer',
        dates: '2022-2023',
        bullets: ['Migrated deployments to Kubernetes and halved release time'],
      },
    ],
    projects: [
      {
        name: 'Trailmark',
        description: 'Offline hiking companion',
        individualOrGroup: 'individual',
        techStack: ['React Native', 'SQLite'],
        narrativeFragments: [
          'Designed an offline-first sync layer so hikers keep working without signal',
          'Shipped the React Native build to both stores single-handedly',
        ],
      },
      {
        name: 'Ledgerly',
        description: 'Small business bookkeeping',
        individualOrGroup: 'group',
        techStack: ['Python', 'Postgres'],
        narrativeFragments: [
          'Wrote the double-entry ledger engine and reconciled historical imports',
        ],
      },
    ],
    standardAnswers: [
      {
        questionPattern: 'why do you want to work at this company',
        answerText:
          'Because the product is used daily by people I know, and that shortens my feedback loop.',
      },
      {
        questionPattern: 'describe a disagreement with a colleague',
        answerText: 'I proposed a smaller migration, we prototyped both, and the data settled it.',
      },
    ],
  };
}

describe('retrieveFragments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ranks the fragments of the project whose vocabulary the field matches highest', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe your React Native experience' }),
      context(),
      profile(),
      2,
    );

    expect(results).toHaveLength(2);
    // Both of Trailmark's fragments outrank everything else: the project's tech
    // stack is folded into its fragments' searchable terms.
    expect(results[0]).toContain('Trailmark');
    expect(results[1]).toContain('Trailmark');
    expect(results.join(' ')).not.toContain('Ledgerly');
  });

  it('attributes a work-history bullet to its role and company', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Tell us about your Kubernetes experience' }),
      context(),
      profile(),
      1,
    );

    expect(results[0]).toContain('Kubernetes');
    // A bare bullet in a prompt is context-free; provenance travels with it.
    expect(results[0]).toContain('Platform Engineer at Harbour Logistics');
    expect(results[0]).toContain('2022-2023');
  });

  it('names the project a narrative fragment came from', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe an offline-first architecture you built' }),
      context(),
      profile(),
      1,
    );

    expect(results[0]).toContain('Project "Trailmark"');
    expect(results[0]).toContain('individual');
  });

  it('surfaces a matching standard answer above general prose', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Why do you want to work here?' }),
      context(),
      profile(),
      1,
    );

    expect(results[0]).toContain('shortens my feedback loop');
  });

  it('returns an empty array for an empty profile', () => {
    expect(
      retrieveFragments(field({ resolvedLabel: 'Cover Letter' }), context(), emptyProfile()),
    ).toEqual([]);
  });

  it('returns an empty array when nothing clears the relevance bar', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Favourite sandwich', surroundingText: 'Pick a filling' }),
      context({ pageTitle: 'Underwater Basket Weaver', rawText: 'Weave baskets underwater.' }),
      profile(),
    );

    expect(results).toEqual([]);
  });

  it('respects k, and caps at the number of relevant fragments available', () => {
    const query = field({ resolvedLabel: 'Describe your React and Kubernetes experience' });

    expect(retrieveFragments(query, context(), profile(), 1)).toHaveLength(1);
    expect(retrieveFragments(query, context(), profile(), 2)).toHaveLength(2);
    // Asking for more than exists returns what exists, not padding.
    const many = retrieveFragments(query, context(), profile(), 50);
    expect(many.length).toBeGreaterThan(0);
    expect(many.length).toBeLessThanOrEqual(6);
  });

  it('defaults to DEFAULT_K fragments', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe your React, Kubernetes and Python experience' }),
      context(),
      profile(),
    );
    expect(results.length).toBeLessThanOrEqual(DEFAULT_K);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns an empty array for a non-positive or non-finite k', () => {
    const query = field({ resolvedLabel: 'Describe your React Native experience' });
    expect(retrieveFragments(query, context(), profile(), 0)).toEqual([]);
    expect(retrieveFragments(query, context(), profile(), -1)).toEqual([]);
    expect(retrieveFragments(query, context(), profile(), Number.NaN)).toEqual([]);
  });

  it('is deterministic across repeated calls', () => {
    const query = field({
      resolvedLabel: 'Tell us about a project',
      surroundingText: 'Any relevant work is fine',
    });
    const jobContext = context({
      pageTitle: 'Mobile Engineer',
      rawText: 'React Native, offline sync, and app store releases.',
    });

    const first = retrieveFragments(query, jobContext, profile());
    const second = retrieveFragments(query, jobContext, profile());
    expect(first).toEqual(second);
  });

  it('lets the job description drive retrieval when the label is generic', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Cover Letter' }),
      context({
        pageTitle: 'Mobile Engineer',
        rawText: 'You will own our React Native app, its offline sync layer, and store releases.',
      }),
      profile(),
      2,
    );

    // "Cover Letter" matches nothing in the profile; the job ad has to carry it.
    expect(results.join(' ')).toContain('Trailmark');
  });

  it(`needs ${MIN_JOB_CONTEXT_MATCHES} job-description terms before job context alone qualifies a fragment`, () => {
    const narrow: ProfileData = {
      ...emptyProfile(),
      projects: [
        {
          name: 'Zephyr',
          description: 'Telemetry tooling',
          individualOrGroup: 'individual',
          techStack: ['Rust'],
          narrativeFragments: ['Built a wavelet compressor for telemetry streams'],
        },
      ],
    };
    const unrelatedField = field({
      resolvedLabel: 'Favourite sandwich',
      surroundingText: 'Pick a filling',
    });

    // Two matching terms is under the bar.
    expect(
      retrieveFragments(
        unrelatedField,
        context({ rawText: 'Bring telemetry and compressor knowledge.' }),
        narrow,
      ),
    ).toEqual([]);

    // Three clears it.
    expect(
      retrieveFragments(
        unrelatedField,
        context({ rawText: 'Bring telemetry, compressor and wavelet knowledge.' }),
        narrow,
      ),
    ).toHaveLength(1);
  });

  it('skips blank fragments instead of returning empty strings', () => {
    const padded: ProfileData = {
      ...emptyProfile(),
      workHistory: [
        {
          company: 'Northwind Retail',
          role: 'Frontend Engineer',
          dates: '',
          bullets: ['', '   ', 'Rebuilt the checkout page in React'],
        },
      ],
      projects: [
        {
          name: 'Blank',
          description: '',
          individualOrGroup: 'individual',
          techStack: ['', 'React'],
          narrativeFragments: ['  '],
        },
      ],
      standardAnswers: [{ questionPattern: 'react experience', answerText: '  ' }],
    };

    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe your React experience' }),
      context(),
      padded,
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toContain('Rebuilt the checkout page');
    // A missing date range must not leave stray punctuation in the prompt.
    expect(results[0]).toBe(
      'Frontend Engineer at Northwind Retail: Rebuilt the checkout page in React',
    );
  });

  it('collapses a fragment the user entered twice', () => {
    const duplicated: ProfileData = {
      ...emptyProfile(),
      workHistory: [
        {
          company: 'Northwind Retail',
          role: 'Frontend Engineer',
          dates: '2023',
          bullets: ['Rebuilt the checkout page in React', 'Rebuilt the checkout page in React'],
        },
      ],
    };

    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe your React experience' }),
      context(),
      duplicated,
      5,
    );
    expect(results).toHaveLength(1);
  });

  it('matches a plural label against a singular fragment', () => {
    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe your deployments experience' }),
      context(),
      profile(),
      1,
    );
    expect(results[0]).toContain('Migrated deployments to Kubernetes');
  });

  it('handles an empty query without throwing', () => {
    expect(retrieveFragments(field(), context(), profile())).toEqual([]);
  });

  it('does not count a shared instruction verb as relevance', () => {
    // "Describe" appears in the label and in the standard answer's pattern, and
    // nowhere else in the profile — which would hand it a high IDF if it counted.
    const results = retrieveFragments(
      field({ resolvedLabel: 'Describe your quantum annealing work' }),
      context(),
      {
        ...emptyProfile(),
        standardAnswers: [
          {
            questionPattern: 'describe a disagreement with a colleague',
            answerText: 'I proposed a smaller migration and the data settled it.',
          },
        ],
      },
    );

    expect(results).toEqual([]);
  });

  it('makes no network call', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    retrieveFragments(
      field({ resolvedLabel: 'Describe your React Native experience' }),
      context(),
      profile(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
