import { describe, it, expect, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { filterByAI, filterByHeuristic } from '../../lib/field-relevance';
import { savePromptSettings, saveSettings } from '../../lib/storage';
import { DEFAULT_PROMPT_SETTINGS } from '../../lib/prompt-settings';
import type { DetectedField } from '../../lib/types';

/** Minimal field stub for testing. */
function field(label: string, surrounding = '', type = 'input:text'): DetectedField {
  return {
    tempId: `f-${label}`,
    resolvedLabel: label,
    labelConfidence: 'structured',
    elementType: type,
    domRef: `ref-${label}`,
    currentValue: '',
    surroundingText: surrounding,
  };
}

describe('filterByHeuristic', () => {
  it('keeps standard application fields', () => {
    const fields = [
      field('Full Name'),
      field('Email Address'),
      field('Phone Number'),
      field('Cover Letter'),
      field('Years of Experience'),
      field('LinkedIn URL'),
      field('Why do you want to work here?'),
    ];

    expect(filterByHeuristic(fields)).toHaveLength(7);
  });

  describe('filterByAI prompts', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('uses the saved system prompt and output reminder', async () => {
      fakeBrowser.reset();
      await saveSettings({ apiKey: 'test-key', modelId: 'test-model' });
      await savePromptSettings({
        ...DEFAULT_PROMPT_SETTINGS,
        fieldRelevanceSystem: 'Custom relevance system prompt',
        fieldRelevanceReminder: 'Custom relevance output instruction',
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ relevant: ['f-Email'] }) }],
                },
                finishReason: 'STOP',
              },
            ],
          }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const email = field('Email');
      await filterByAI([email], {
        rawText: 'Engineering role',
        url: 'https://jobs.example.com/role',
        pageTitle: 'Engineer',
      });

      const request = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(request.systemInstruction.parts[0].text).toBe('Custom relevance system prompt');
      expect(request.contents[0].parts[0].text).toContain('Custom relevance output instruction');
    });
  });

  it('removes search bars', () => {
    const fields = [field('Search jobs'), field('Search'), field('Full Name')];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.resolvedLabel).toBe('Full Name');
  });

  it('removes newsletter and subscribe fields', () => {
    const fields = [
      field('Subscribe to newsletter'),
      field('Newsletter email'),
      field('Full Name'),
    ];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.resolvedLabel).toBe('Full Name');
  });

  it('removes login and password fields', () => {
    const fields = [
      field('Password'),
      field('Log in'),
      field('Sign in'),
      field('Create account email'),
      field('Full Name'),
    ];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.resolvedLabel).toBe('Full Name');
  });

  it('removes cookie consent and captcha fields', () => {
    const fields = [field('Cookie preferences'), field('Captcha'), field('Full Name')];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.resolvedLabel).toBe('Full Name');
  });

  it('removes fields based on surrounding text even when label is clean', () => {
    const fields = [
      field('Email', 'Subscribe to our newsletter for updates'),
      field('Email', 'Enter your email address to apply'),
    ];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.surroundingText).toContain('apply');
  });

  it('removes filter and sort controls', () => {
    const fields = [
      field('Filter by location'),
      field('Sort results'),
      field('Find jobs'),
      field('Full Name'),
    ];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.resolvedLabel).toBe('Full Name');
  });

  it('removes feedback and comment fields', () => {
    const fields = [
      field('Leave a comment'),
      field('Your feedback'),
      field('Write a review'),
      field('Full Name'),
    ];

    const result = filterByHeuristic(fields);
    expect(result).toHaveLength(1);
    expect(result[0]!.resolvedLabel).toBe('Full Name');
  });

  it('keeps ambiguous fields (fail-open)', () => {
    const fields = [field('Other'), field('Additional Information'), field('')];

    // None of these match exclusion patterns, so they should all be kept.
    expect(filterByHeuristic(fields)).toHaveLength(3);
  });

  it('returns an empty array when all fields are excluded', () => {
    const fields = [field('Search jobs'), field('Newsletter subscribe')];

    expect(filterByHeuristic(fields)).toHaveLength(0);
  });

  it('returns an empty array for empty input', () => {
    expect(filterByHeuristic([])).toHaveLength(0);
  });
});
