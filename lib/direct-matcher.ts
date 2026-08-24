import type { DetectedField, GeneratedAnswer, ProfileData } from './types';

// Direct, deterministic matching of obvious standard profile fields.
//
// Obvious static information (Name, Email, Phone, Social Links, University,
// Degree, Current Company, Recent Job Title) is already saved in local extension
// storage and does NOT need an LLM API call.
//
// This saves API tokens, avoids network latency, works even without an API key,
// and ensures 100% accurate verbatim answers without AI hallucinations.

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasText(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Match a detected field against known profile fields.
 * Returns a `GeneratedAnswer` if an exact/obvious match is found, or `null`.
 */
export function matchDirectProfileAnswer(
  field: DetectedField,
  profile: ProfileData,
): GeneratedAnswer | null {
  const label = collapse(field.resolvedLabel);
  const type = field.elementType.toLowerCase();

  // 1. Email Address
  if (
    type === 'input:email' ||
    /\b(email|e-mail|email\s*address|work\s*email|contact\s*email)\b/i.test(label)
  ) {
    if (hasText(profile.personal?.email)) {
      return {
        tempId: field.tempId,
        classifiedType: 'email',
        confidence: 'high',
        draftAnswer: profile.personal.email.trim(),
      };
    }
  }

  // 2. Phone Number
  if (
    type === 'input:tel' ||
    /\b(phone|phone\s*number|mobile|mobile\s*number|mobile\s*phone|cell|cell\s*phone|telephone|contact\s*number)\b/i.test(
      label,
    )
  ) {
    if (hasText(profile.personal?.phone)) {
      return {
        tempId: field.tempId,
        classifiedType: 'phone',
        confidence: 'high',
        draftAnswer: profile.personal.phone.trim(),
      };
    }
  }

  // 3. First Name / Given Name
  if (/\b(first\s*name|given\s*name|forename)\b/i.test(label)) {
    if (hasText(profile.personal?.name)) {
      const parts = profile.personal.name.trim().split(/\s+/);
      const firstName = parts[0] ?? profile.personal.name.trim();
      return {
        tempId: field.tempId,
        classifiedType: 'name',
        confidence: 'high',
        draftAnswer: firstName,
      };
    }
  }

  // 4. Last Name / Surname
  if (/\b(last\s*name|family\s*name|surname)\b/i.test(label)) {
    if (hasText(profile.personal?.name)) {
      const parts = profile.personal.name.trim().split(/\s+/);
      const lastName = parts.length > 1 ? parts.slice(1).join(' ') : (parts[0] ?? '');
      return {
        tempId: field.tempId,
        classifiedType: 'name',
        confidence: 'high',
        draftAnswer: lastName,
      };
    }
  }

  // 5. Full Name / Name
  if (
    /\b(full\s*name|your\s*name|applicant\s*name|legal\s*name|candidate\s*name|complete\s*name)\b/i.test(
      label,
    ) ||
    label === 'name'
  ) {
    if (hasText(profile.personal?.name)) {
      return {
        tempId: field.tempId,
        classifiedType: 'name',
        confidence: 'high',
        draftAnswer: profile.personal.name.trim(),
      };
    }
  }

  // 6. LinkedIn URL / Profile
  if (/\b(linkedin|linked\s*in)\b/i.test(label)) {
    if (hasText(profile.personal?.links?.linkedin)) {
      return {
        tempId: field.tempId,
        classifiedType: 'url',
        confidence: 'high',
        draftAnswer: profile.personal.links.linkedin!.trim(),
      };
    }
  }

  // 7. GitHub URL / Profile
  if (/\b(github|git\s*hub)\b/i.test(label)) {
    if (hasText(profile.personal?.links?.github)) {
      return {
        tempId: field.tempId,
        classifiedType: 'url',
        confidence: 'high',
        draftAnswer: profile.personal.links.github!.trim(),
      };
    }
  }

  // 8. Portfolio / Website / Personal Site
  if (/\b(portfolio|personal\s*website|website|personal\s*site|blog|homepage)\b/i.test(label)) {
    if (hasText(profile.personal?.links?.portfolio)) {
      return {
        tempId: field.tempId,
        classifiedType: 'url',
        confidence: 'high',
        draftAnswer: profile.personal.links.portfolio!.trim(),
      };
    }
  }

  // 9. University / College / School / Institution
  if (
    /\b(university|college|school|institution|alma\s*mater|educational\s*institution)\b/i.test(
      label,
    )
  ) {
    const latestEdu = profile.education?.find((e) => hasText(e.institution));
    if (latestEdu) {
      return {
        tempId: field.tempId,
        classifiedType: 'education',
        confidence: 'high',
        draftAnswer: latestEdu.institution.trim(),
      };
    }
  }

  // 10. Degree / Major / Program of study
  if (
    /\b(degree|major|field\s*of\s*study|program\s*of\s*study|area\s*of\s*study|qualification)\b/i.test(
      label,
    )
  ) {
    const latestEdu = profile.education?.find((e) => hasText(e.program));
    if (latestEdu) {
      return {
        tempId: field.tempId,
        classifiedType: 'education',
        confidence: 'high',
        draftAnswer: latestEdu.program.trim(),
      };
    }
  }

  // 11. Current / Recent Company / Employer
  if (
    /\b(current\s*company|current\s*employer|most\s*recent\s*company|most\s*recent\s*employer|previous\s*company|previous\s*employer|present\s*company|company\s*name)\b/i.test(
      label,
    ) ||
    label === 'company' ||
    label === 'employer'
  ) {
    const latestJob = profile.workHistory?.find((j) => hasText(j.company));
    if (latestJob) {
      return {
        tempId: field.tempId,
        classifiedType: 'experience-summary',
        confidence: 'high',
        draftAnswer: latestJob.company.trim(),
      };
    }
  }

  // 12. Current / Recent Job Title / Role
  if (
    /\b(current\s*title|current\s*job\s*title|current\s*role|current\s*position|most\s*recent\s*title|recent\s*job\s*title|job\s*title|present\s*title|present\s*role)\b/i.test(
      label,
    ) ||
    label === 'title' ||
    label === 'current role'
  ) {
    const latestJob = profile.workHistory?.find((j) => hasText(j.role));
    if (latestJob) {
      return {
        tempId: field.tempId,
        classifiedType: 'experience-summary',
        confidence: 'high',
        draftAnswer: latestJob.role.trim(),
      };
    }
  }

  return null;
}
