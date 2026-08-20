import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearFieldMappings,
  correctionHints,
  findFieldMapping,
  getFieldMappings,
  saveFieldMapping,
} from '../../lib/mapping-cache';
import type { DetectedField } from '../../lib/types';

// Phase 14. The behaviour that matters is that a correction comes back for the
// site and label it was saved against, that everything else comes back empty
// rather than throwing, and that a hint can only ever describe a field the
// detector already found.

function field(
  tempId: string,
  resolvedLabel: string,
): Pick<DetectedField, 'tempId' | 'resolvedLabel'> {
  return { tempId, resolvedLabel };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('saveFieldMapping / getFieldMappings', () => {
  it('reads back a saved correction for the same site', async () => {
    await saveFieldMapping({
      domain: 'jobs.example.com',
      resolvedLabel: 'Tell us about you',
      correctedType: 'cover letter',
    });

    expect(await getFieldMappings('jobs.example.com')).toEqual([
      { resolvedLabel: 'Tell us about you', correctedType: 'cover letter' },
    ]);
  });

  it('returns an empty list for a site with nothing saved', async () => {
    // A first visit is the normal case, so it must not look like a failure.
    await expect(getFieldMappings('never-seen.example.com')).resolves.toEqual([]);
    await expect(getFieldMappings('')).resolves.toEqual([]);
    await expect(findFieldMapping('never-seen.example.com', 'Anything')).resolves.toBeNull();
  });

  it('keeps sites apart', async () => {
    await saveFieldMapping({
      domain: 'a.example.com',
      resolvedLabel: 'Why us?',
      correctedType: 'motivation',
    });
    await saveFieldMapping({
      domain: 'b.example.com',
      resolvedLabel: 'Why us?',
      correctedType: 'company research',
    });

    expect((await findFieldMapping('a.example.com', 'Why us?'))?.correctedType).toBe('motivation');
    expect((await findFieldMapping('b.example.com', 'Why us?'))?.correctedType).toBe(
      'company research',
    );
  });

  it('replaces an earlier correction for the same label instead of stacking', async () => {
    const save = (correctedType: string) =>
      saveFieldMapping({ domain: 'jobs.example.com', resolvedLabel: 'Summary', correctedType });

    await save('experience summary');
    await save('salary expectation');

    // The user has just said the previous answer was wrong; two conflicting
    // hints for one label would be worse than none.
    expect(await getFieldMappings('jobs.example.com')).toEqual([
      { resolvedLabel: 'Summary', correctedType: 'salary expectation' },
    ]);
  });

  it('matches a label whose spacing or casing has changed', async () => {
    await saveFieldMapping({
      domain: 'JOBS.example.com',
      resolvedLabel: 'Cover Letter',
      correctedType: 'cover letter',
    });

    // Same question, re-rendered: the correction should survive it.
    expect(await findFieldMapping('jobs.example.com', '  cover   letter ')).toEqual({
      resolvedLabel: 'Cover Letter',
      correctedType: 'cover letter',
    });
  });

  it('refuses a correction that could never be matched again', async () => {
    const cases = [
      { domain: '', resolvedLabel: 'Label', correctedType: 'type' },
      { domain: 'jobs.example.com', resolvedLabel: '   ', correctedType: 'type' },
      { domain: 'jobs.example.com', resolvedLabel: 'Label', correctedType: '' },
    ];

    for (const bad of cases) {
      await expect(saveFieldMapping(bad)).rejects.toThrow(/needs a site, a field label/);
    }
    expect(await getFieldMappings('jobs.example.com')).toEqual([]);
  });

  it('forgets a site on request', async () => {
    await saveFieldMapping({
      domain: 'jobs.example.com',
      resolvedLabel: 'Summary',
      correctedType: 'experience summary',
    });

    await clearFieldMappings('jobs.example.com');
    expect(await getFieldMappings('jobs.example.com')).toEqual([]);
    // Clearing a site that was never saved is a no-op, not an error.
    await expect(clearFieldMappings('other.example.com')).resolves.toBeUndefined();
  });

  it('caps how much one site can accumulate, dropping the oldest', async () => {
    // Nothing else prunes this store, so the cap is the only thing standing
    // between a heavily used site and unbounded growth.
    for (let i = 0; i < 105; i++) {
      await saveFieldMapping({
        domain: 'jobs.example.com',
        resolvedLabel: `Question ${i}`,
        correctedType: `type ${i}`,
      });
    }

    const saved = await getFieldMappings('jobs.example.com');
    expect(saved).toHaveLength(100);
    expect(saved[0]!.resolvedLabel).toBe('Question 5');
    expect(saved[99]!.resolvedLabel).toBe('Question 104');
  });
});

describe('correctionHints', () => {
  it('keys the matching corrections by tempId, and only those', async () => {
    await saveFieldMapping({
      domain: 'jobs.example.com',
      resolvedLabel: 'Tell us about you',
      correctedType: 'cover letter',
    });
    await saveFieldMapping({
      domain: 'jobs.example.com',
      resolvedLabel: 'Notice period',
      correctedType: 'availability',
    });

    const hints = await correctionHints(
      [field('f0', 'Tell us about you'), field('f1', 'Full Name')],
      'https://jobs.example.com/roles/42',
    );

    // f1 was never corrected, so it gets no hint rather than a nearest guess.
    expect(hints).toEqual({ f0: 'cover letter' });
  });

  it('has nothing to say about a site, or a page, it has never seen', async () => {
    await expect(
      correctionHints([field('f0', 'Cover Letter')], 'https://elsewhere.example.com/apply'),
    ).resolves.toEqual({});
    // A URL the browser would not give us, and a page with no fields.
    await expect(correctionHints([field('f0', 'Cover Letter')], 'not a url')).resolves.toEqual({});
    await expect(correctionHints([], 'https://jobs.example.com/apply')).resolves.toEqual({});
  });

  it('ignores the path, so a correction applies across a site', async () => {
    await saveFieldMapping({
      domain: 'jobs.example.com',
      resolvedLabel: 'Why us?',
      correctedType: 'motivation',
    });

    const hints = await correctionHints(
      [field('f0', 'Why us?')],
      'https://jobs.example.com/some/other/role/99?src=email',
    );

    expect(hints).toEqual({ f0: 'motivation' });
  });
});
