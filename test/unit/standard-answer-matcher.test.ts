import { describe, it, expect } from 'vitest';
import { matchAndParaphraseStandardAnswers } from '../../lib/standard-answer-matcher';
import { emptyProfile } from '../../lib/storage';
import type { DetectedField, GeneratedAnswer, JobContext, ProfileData } from '../../lib/types';
import type { BuiltPrompt, Generator } from '../../lib/generator/types';

function field(
  label: string,
  type = 'textarea',
  overrides: Partial<DetectedField> = {},
): DetectedField {
  return {
    tempId: `f-${label.replace(/\s+/g, '-').toLowerCase()}`,
    resolvedLabel: label,
    labelConfidence: 'structured',
    elementType: type,
    domRef: `ref-${label}`,
    currentValue: '',
    surroundingText: '',
    ...overrides,
  };
}

const context: JobContext = {
  rawText: 'We are hiring a Frontend Engineer to build our design system at TechCorp.',
  url: 'https://jobs.techcorp.com/frontend-engineer',
  pageTitle: 'Frontend Engineer at TechCorp',
};

function profileWithStandardAnswers(): ProfileData {
  return {
    ...emptyProfile(),
    personal: {
      name: 'Yasiru Kaveeshwara',
      email: 'yasiru@example.com',
      phone: '+94 77 123 4567',
      links: {},
    },
    standardAnswers: [
      {
        questionPattern: 'Cover Letter',
        answerText:
          "Dear Hiring Manager,\n\nI'm excited to apply for the position at your company. " +
          'I have 3 years of experience in full-stack development using React, Node.js, and TypeScript. ' +
          'At Visionex Digital, I built scalable microservices that handled 10,000 requests per second.\n\n' +
          'Best regards,\nYasiru',
      },
      {
        questionPattern: 'Are you authorized to work in Sri Lanka?',
        answerText: 'Yes, I am a citizen of Sri Lanka.',
      },
    ],
  };
}

/** A generator that returns whatever answers are passed in and captures prompts. */
function capturing(answers: GeneratedAnswer[]): { generator: Generator; prompts: BuiltPrompt[] } {
  const prompts: BuiltPrompt[] = [];
  const generator: Generator = {
    generate: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(answers);
    },
  };
  return { generator, prompts };
}

/** A generator that simulates the AI matching cover letter to a field. */
function matchingGenerator(
  fieldTempId: string,
  paraphrasedText: string,
): { generator: Generator; prompts: BuiltPrompt[] } {
  return capturing([
    {
      tempId: fieldTempId,
      classifiedType: 'standard-answer',
      confidence: 'high',
      draftAnswer: paraphrasedText,
    },
  ]);
}

function failingGenerator(error: Error): Generator {
  return { generate: () => Promise.reject(error) };
}

describe('matchAndParaphraseStandardAnswers', () => {
  it('returns empty map when profile has no standard answers', async () => {
    const profile = emptyProfile();
    const { generator, prompts } = capturing([]);

    const result = await matchAndParaphraseStandardAnswers(
      [field('Cover Letter')],
      profile,
      context,
      generator,
    );

    expect(result).toEqual({});
    // No API call should have been made.
    expect(prompts).toHaveLength(0);
  });

  it('returns empty map when fields array is empty', async () => {
    const profile = profileWithStandardAnswers();
    const { generator, prompts } = capturing([]);

    const result = await matchAndParaphraseStandardAnswers([], profile, context, generator);

    expect(result).toEqual({});
    expect(prompts).toHaveLength(0);
  });

  it('returns empty map when standard answers have empty patterns/text', async () => {
    const profile = {
      ...emptyProfile(),
      standardAnswers: [
        { questionPattern: '', answerText: 'some text' },
        { questionPattern: 'some pattern', answerText: '' },
      ],
    };
    const { generator, prompts } = capturing([]);

    const result = await matchAndParaphraseStandardAnswers(
      [field('Cover Letter')],
      profile,
      context,
      generator,
    );

    expect(result).toEqual({});
    expect(prompts).toHaveLength(0);
  });

  it('sends standard answers and fields to the generator for semantic matching', async () => {
    const profile = profileWithStandardAnswers();
    const paraphrased =
      "Dear Hiring Manager,\n\nI'm excited to apply for the Frontend Engineer position at TechCorp. " +
      'I have 3 years of experience in full-stack development using React, Node.js, and TypeScript. ' +
      'At Visionex Digital, I built scalable microservices that handled 10,000 requests per second.\n\n' +
      'Best regards,\nYasiru';

    const { generator, prompts } = matchingGenerator('f-cover-letter', paraphrased);

    const result = await matchAndParaphraseStandardAnswers(
      [field('Cover Letter')],
      profile,
      context,
      generator,
    );

    // The prompt should contain the standard answers and the job context.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.user).toContain('Cover Letter');
    expect(prompts[0]!.user).toContain('Visionex Digital');
    expect(prompts[0]!.user).toContain('Frontend Engineer at TechCorp');
    expect(prompts[0]!.system).toContain('semantic');

    // Should return the paraphrased answer keyed by tempId.
    expect(result['f-cover-letter']).toBeDefined();
    expect(result['f-cover-letter']!.draftAnswer).toBe(paraphrased);
    expect(result['f-cover-letter']!.classifiedType).toBe('standard-answer');
  });

  it('includes multiple fields and lets the model decide which match', async () => {
    const profile = profileWithStandardAnswers();
    const coverId = 'f-message-to-hiring-team';
    const authId = 'f-work-authorization';

    const { generator } = capturing([
      {
        tempId: coverId,
        classifiedType: 'standard-answer',
        confidence: 'high',
        draftAnswer: 'Adapted cover letter for TechCorp.',
      },
      {
        tempId: authId,
        classifiedType: 'standard-answer',
        confidence: 'high',
        draftAnswer: 'Yes, I am a citizen of Sri Lanka.',
      },
    ]);

    const fields = [
      field('Message to hiring team', 'textarea', { tempId: coverId }),
      field('Work Authorization', 'input:text', { tempId: authId }),
      field('Years of experience', 'input:text', { tempId: 'f-years' }),
    ];

    const result = await matchAndParaphraseStandardAnswers(fields, profile, context, generator);

    // Two fields matched, one did not.
    expect(Object.keys(result)).toHaveLength(2);
    expect(result[coverId]).toBeDefined();
    expect(result[authId]).toBeDefined();
    expect(result['f-years']).toBeUndefined();
  });

  it('ignores answers with tempIds not in the input fields (hallucinated)', async () => {
    const profile = profileWithStandardAnswers();

    const { generator } = capturing([
      {
        tempId: 'f-cover-letter',
        classifiedType: 'standard-answer',
        confidence: 'high',
        draftAnswer: 'Adapted answer.',
      },
      {
        tempId: 'f-HALLUCINATED',
        classifiedType: 'standard-answer',
        confidence: 'high',
        draftAnswer: 'This field does not exist.',
      },
    ]);

    const result = await matchAndParaphraseStandardAnswers(
      [field('Cover Letter')],
      profile,
      context,
      generator,
    );

    expect(Object.keys(result)).toHaveLength(1);
    expect(result['f-cover-letter']).toBeDefined();
    expect(result['f-HALLUCINATED']).toBeUndefined();
  });

  it('includes job context (title, URL, posting text) in the prompt', async () => {
    const profile = profileWithStandardAnswers();
    const { generator, prompts } = matchingGenerator('f-cover-letter', 'Adapted.');

    await matchAndParaphraseStandardAnswers([field('Cover Letter')], profile, context, generator);

    const userPrompt = prompts[0]!.user;
    expect(userPrompt).toContain('Frontend Engineer at TechCorp');
    expect(userPrompt).toContain('jobs.techcorp.com');
    expect(userPrompt).toContain('design system at TechCorp');
  });

  it('propagates generator failures', async () => {
    const profile = profileWithStandardAnswers();
    const error = new Error('API key invalid');

    await expect(
      matchAndParaphraseStandardAnswers(
        [field('Cover Letter')],
        profile,
        context,
        failingGenerator(error),
      ),
    ).rejects.toThrow('API key invalid');
  });

  it('keeps only the first answer when the model returns duplicates for a field', async () => {
    const profile = profileWithStandardAnswers();

    const { generator } = capturing([
      {
        tempId: 'f-cover-letter',
        classifiedType: 'standard-answer',
        confidence: 'high',
        draftAnswer: 'First version.',
      },
      {
        tempId: 'f-cover-letter',
        classifiedType: 'standard-answer',
        confidence: 'high',
        draftAnswer: 'Duplicate version.',
      },
    ]);

    const result = await matchAndParaphraseStandardAnswers(
      [field('Cover Letter')],
      profile,
      context,
      generator,
    );

    expect(result['f-cover-letter']!.draftAnswer).toBe('First version.');
  });
});
