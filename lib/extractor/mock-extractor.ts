import type { ExtractedProfileData } from '../types';
import { GeneratorError } from '../generator/types';
import type { ProfileExtractor } from './types';

// Deterministic, offline, free. Every test of the CV import path runs against
// this, so the suite never needs a key, a network, or a real PDF — and the
// review screen can be exercised by hand the same way (see lib/extractor/index).

/**
 * A CV that exists only here, and looks like one.
 *
 * Shaped to cover every category the review screen groups by, including the
 * cases that are easy to get wrong: an entry with no dates, a project with a
 * tech stack, a skill list long enough to need discarding from. The address is
 * `example.com` (RFC 2606) so nothing here can reach a real person.
 */
export const MOCK_EXTRACTED_CV: ExtractedProfileData = {
  personal: {
    name: 'Mock Candidate',
    email: 'mock.candidate@example.com',
    phone: '+1 555 0100',
    links: {
      github: 'https://github.com/mock-candidate',
      linkedin: 'https://www.linkedin.com/in/mock-candidate',
    },
  },
  education: [
    {
      institution: 'University of Somewhere',
      program: 'BSc Computer Science',
      dates: '2016 – 2020',
    },
    { institution: 'Somewhere Community College', program: 'Mathematics', dates: '' },
  ],
  workHistory: [
    {
      company: 'Northwind Traders',
      role: 'Senior Software Engineer',
      dates: '2022 – present',
      bullets: [
        'Led the migration of the billing service to TypeScript.',
        'Cut median checkout latency from 900 ms to 240 ms.',
      ],
    },
    {
      company: 'Contoso',
      role: 'Software Engineer',
      dates: '2020 – 2022',
      bullets: ['Built the internal admin console used by 40 support staff.'],
    },
  ],
  projectsRaw: [
    {
      name: 'Ledger CLI',
      description: 'A command-line double-entry bookkeeping tool with plain-text storage.',
      techStack: ['Rust', 'SQLite'],
    },
    {
      name: 'Tide',
      description: 'A static site generator for tide-chart data.',
      techStack: ['TypeScript', 'D3'],
    },
  ],
  skills: ['TypeScript', 'Rust', 'PostgreSQL', 'Kubernetes', 'Playwright'],
};

export interface MockExtractorOptions {
  /**
   * Make `extract` reject with this message, so the upload and review error
   * paths can be exercised without a provider that can be made to fail.
   */
  failWith?: string;
  /** Replace the canned CV, for tests that need a particular shape. */
  data?: ExtractedProfileData;
}

/** A `ProfileExtractor` that answers from canned data. No network call. */
export class MockExtractor implements ProfileExtractor {
  private readonly options: MockExtractorOptions;

  constructor(options: MockExtractorOptions = {}) {
    this.options = options;
  }

  // No parameter: the uploaded bytes are ignored on purpose — the point is a
  // fixed answer, and a mock that only worked on a real PDF would need one
  // committed to the repo. A method that takes fewer arguments still satisfies
  // `ProfileExtractor`.
  extract(): Promise<ExtractedProfileData> {
    if (this.options.failWith !== undefined) {
      return Promise.reject(new GeneratorError('response', this.options.failWith));
    }
    // Copied, so a caller editing the review items it builds from this cannot
    // change what the next call returns.
    return Promise.resolve(structuredClone(this.options.data ?? MOCK_EXTRACTED_CV));
  }
}
