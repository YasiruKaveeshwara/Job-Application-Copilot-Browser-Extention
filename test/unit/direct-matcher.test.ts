import { describe, it, expect } from 'vitest';
import { matchDirectProfileAnswer } from '../../lib/direct-matcher';
import { emptyProfile } from '../../lib/storage';
import type { DetectedField, ProfileData } from '../../lib/types';

function field(
  label: string,
  type = 'input:text',
  overrides: Partial<DetectedField> = {},
): DetectedField {
  return {
    tempId: `f-${label}`,
    resolvedLabel: label,
    labelConfidence: 'structured',
    elementType: type,
    domRef: `ref-${label}`,
    currentValue: '',
    surroundingText: '',
    ...overrides,
  };
}

function sampleProfile(): ProfileData {
  return {
    ...emptyProfile(),
    personal: {
      name: 'Yasiru Kaveeshwara',
      email: 'yasiru@example.com',
      phone: '+94 77 123 4567',
      links: {
        linkedin: 'https://linkedin.com/in/yasiruk',
        github: 'https://github.com/yasiruk',
        portfolio: 'https://yasiru.dev',
      },
    },
    education: [
      {
        institution: 'University of Colombo',
        program: 'B.Sc. in Computer Science',
        dates: '2020-2024',
      },
    ],
    workHistory: [
      {
        company: 'Acme Corp',
        role: 'Senior Software Engineer',
        dates: '2022-Present',
        bullets: ['Built scalable microservices'],
      },
    ],
    standardAnswers: [
      {
        questionPattern: 'Are you authorized to work in Sri Lanka?',
        answerText: 'Yes, I am a citizen.',
      },
    ],
  };
}

describe('matchDirectProfileAnswer', () => {
  const profile = sampleProfile();

  it('matches full name directly', () => {
    const result = matchDirectProfileAnswer(field('Full Name'), profile);
    expect(result).toEqual({
      tempId: 'f-Full Name',
      classifiedType: 'name',
      confidence: 'high',
      draftAnswer: 'Yasiru Kaveeshwara',
    });
  });

  it('matches first name directly', () => {
    const result = matchDirectProfileAnswer(field('First Name'), profile);
    expect(result).toEqual({
      tempId: 'f-First Name',
      classifiedType: 'name',
      confidence: 'high',
      draftAnswer: 'Yasiru',
    });
  });

  it('matches last name directly', () => {
    const result = matchDirectProfileAnswer(field('Last Name'), profile);
    expect(result).toEqual({
      tempId: 'f-Last Name',
      classifiedType: 'name',
      confidence: 'high',
      draftAnswer: 'Kaveeshwara',
    });
  });

  it('matches email directly by label and by element type', () => {
    const byLabel = matchDirectProfileAnswer(field('Email Address'), profile);
    expect(byLabel).toEqual({
      tempId: 'f-Email Address',
      classifiedType: 'email',
      confidence: 'high',
      draftAnswer: 'yasiru@example.com',
    });

    const byType = matchDirectProfileAnswer(field('Contact', 'input:email'), profile);
    expect(byType?.draftAnswer).toBe('yasiru@example.com');
  });

  it('matches phone directly by label and by element type', () => {
    const byLabel = matchDirectProfileAnswer(field('Phone Number'), profile);
    expect(byLabel).toEqual({
      tempId: 'f-Phone Number',
      classifiedType: 'phone',
      confidence: 'high',
      draftAnswer: '+94 77 123 4567',
    });

    const byType = matchDirectProfileAnswer(field('Mobile', 'input:tel'), profile);
    expect(byType?.draftAnswer).toBe('+94 77 123 4567');
  });

  it('matches social links directly', () => {
    const linkedin = matchDirectProfileAnswer(field('LinkedIn URL'), profile);
    expect(linkedin?.draftAnswer).toBe('https://linkedin.com/in/yasiruk');

    const github = matchDirectProfileAnswer(field('GitHub Profile'), profile);
    expect(github?.draftAnswer).toBe('https://github.com/yasiruk');

    const portfolio = matchDirectProfileAnswer(field('Portfolio Website'), profile);
    expect(portfolio?.draftAnswer).toBe('https://yasiru.dev');
  });

  it('matches university and degree directly', () => {
    const uni = matchDirectProfileAnswer(field('University / College'), profile);
    expect(uni?.draftAnswer).toBe('University of Colombo');

    const degree = matchDirectProfileAnswer(field('Degree / Major'), profile);
    expect(degree?.draftAnswer).toBe('B.Sc. in Computer Science');
  });

  it('matches current company and job title directly', () => {
    const company = matchDirectProfileAnswer(field('Current Company'), profile);
    expect(company?.draftAnswer).toBe('Acme Corp');

    const title = matchDirectProfileAnswer(field('Current Job Title'), profile);
    expect(title?.draftAnswer).toBe('Senior Software Engineer');
  });

  it('does not match standard answers (handled by standard-answer-matcher)', () => {
    const std = matchDirectProfileAnswer(
      field('Are you authorized to work in Sri Lanka?'),
      profile,
    );
    expect(std).toBeNull();
  });

  it('returns null for open-ended questions requiring AI generation', () => {
    expect(matchDirectProfileAnswer(field('Cover Letter', 'textarea'), profile)).toBeNull();
    expect(
      matchDirectProfileAnswer(field('Why do you want to work here?', 'textarea'), profile),
    ).toBeNull();
    expect(
      matchDirectProfileAnswer(field('Describe a challenging bug you fixed', 'textarea'), profile),
    ).toBeNull();
  });

  it('returns null when profile has empty strings for matched fields', () => {
    const empty = emptyProfile();
    expect(matchDirectProfileAnswer(field('Full Name'), empty)).toBeNull();
    expect(matchDirectProfileAnswer(field('Email Address'), empty)).toBeNull();
    expect(matchDirectProfileAnswer(field('University'), empty)).toBeNull();
  });
});
