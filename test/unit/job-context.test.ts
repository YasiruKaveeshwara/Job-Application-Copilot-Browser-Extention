import { describe, it, expect } from 'vitest';
import {
  buildJobContext,
  normalizeRoleFamily,
  roleFamilyHint,
  extractDomain,
} from '../../lib/job-context';
import { PAGE_TEXT_BUDGET } from '../../lib/field-detector';

describe('normalizeRoleFamily', () => {
  it('buckets known software-engineer variants', () => {
    expect(normalizeRoleFamily('Software Engineer')).toBe('software-engineer');
    expect(normalizeRoleFamily('Associate Software Engineer')).toBe('software-engineer');
    expect(normalizeRoleFamily('Senior Software Engineer')).toBe('software-engineer');
    expect(normalizeRoleFamily('SWE')).toBe('software-engineer');
  });

  it('buckets full-stack variants separately from the generic bucket', () => {
    expect(normalizeRoleFamily('Full Stack Developer')).toBe('full-stack-engineer');
    expect(normalizeRoleFamily('Full-Stack Engineer')).toBe('full-stack-engineer');
    expect(normalizeRoleFamily('Fullstack Developer')).toBe('full-stack-engineer');
  });

  it('buckets web developer into the frontend family', () => {
    expect(normalizeRoleFamily('Web Developer')).toBe('frontend-engineer');
    expect(normalizeRoleFamily('Front-End Engineer')).toBe('frontend-engineer');
  });

  it('is case- and punctuation-insensitive and ignores surrounding text', () => {
    expect(normalizeRoleFamily('  SOFTWARE   ENGINEER  ')).toBe('software-engineer');
    expect(normalizeRoleFamily('Software Engineer (Remote) — Acme Inc.')).toBe('software-engineer');
  });

  it('prefers the longest matching synonym', () => {
    // "machine learning engineer" must win over any shorter partial match.
    expect(normalizeRoleFamily('Machine Learning Engineer')).toBe('ml-engineer');
    expect(normalizeRoleFamily('Site Reliability Engineer')).toBe('devops-engineer');
  });

  it('passes unrecognized titles through as null rather than erroring', () => {
    expect(normalizeRoleFamily('Underwater Basket Weaver')).toBeNull();
    expect(normalizeRoleFamily('')).toBeNull();
    expect(normalizeRoleFamily('   ')).toBeNull();
  });

  it('does not match a synonym inside an unrelated word', () => {
    // "sre" must not match inside "stressed".
    expect(normalizeRoleFamily('Stressed Basket Weaver')).toBeNull();
  });
});

describe('roleFamilyHint', () => {
  it('produces a hint line for a known title', () => {
    expect(roleFamilyHint('Software Engineer')).toContain('software-engineer');
    // Framed as a fallible hint, never as an authoritative classification.
    expect(roleFamilyHint('Software Engineer').toLowerCase()).toContain('may be wrong');
  });

  it('produces an empty hint for an unknown title', () => {
    expect(roleFamilyHint('Underwater Basket Weaver')).toBe('');
  });
});

describe('buildJobContext', () => {
  it('passes through url and title, collapsing whitespace', () => {
    const ctx = buildJobContext(
      'We   are\n\nhiring   engineers.',
      'https://jobs.example.com/123 ',
      '  Software   Engineer  ',
    );
    expect(ctx.rawText).toBe('We are hiring engineers.');
    expect(ctx.url).toBe('https://jobs.example.com/123');
    expect(ctx.pageTitle).toBe('Software Engineer');
  });

  it('truncates raw text to the shared page-text budget', () => {
    const ctx = buildJobContext('y'.repeat(PAGE_TEXT_BUDGET + 1000), 'https://x.test', 'Role');
    expect(ctx.rawText.length).toBeLessThanOrEqual(PAGE_TEXT_BUDGET);
  });

  it('handles empty input without throwing', () => {
    const ctx = buildJobContext('', '', '');
    expect(ctx).toEqual({ rawText: '', url: '', pageTitle: '' });
  });
});

describe('extractDomain', () => {
  it('extracts the hostname', () => {
    expect(extractDomain('https://boards.greenhouse.io/acme/jobs/1')).toBe('boards.greenhouse.io');
  });

  it('returns an empty string for an unparseable url', () => {
    expect(extractDomain('not a url')).toBe('');
  });
});
