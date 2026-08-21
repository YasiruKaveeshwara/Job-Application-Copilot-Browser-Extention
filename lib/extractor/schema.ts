import { z } from 'zod';
import type { ExtractedProfileData } from '../types';
import { stripCodeFence } from '../schema-validator';

// The boundary between "whatever the model read off the PDF" and typed data the
// options page is allowed to show. Same job as lib/schema-validator.ts does for
// generated answers, with one deliberate difference: that validator *drops*
// unrecognized keys, and here they have to be rejected.
//
// The reason is the feature's one hard rule. Five parts of a profile must never
// come from a document — `individualOrGroup`, `narrativeFragments`,
// `standardAnswers`, `stylePreferences`, `resumeVariants` — because they are
// framing decisions the CV cannot state (see ExtractedProfileData in lib/types).
// Silently dropping them would mean a model that started returning them, or a
// prompt that drifted into asking for them, looked exactly like one that did not.
// Every object below is strict, so the first response that contains one fails
// loudly and names the key.

/** Thrown when a CV extraction response does not match the expected shape. */
export class ExtractionSchemaError extends Error {
  /** One entry per problem, so the UI can show all of them at once. */
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(issues.length > 0 ? `${message}: ${issues.join('; ')}` : message);
    this.name = 'ExtractionSchemaError';
    this.issues = issues;
  }
}

/** Trimmed, because PDF text extraction leaves ragged whitespace everywhere. */
const text = z.string().trim();

/**
 * Present-but-blank is allowed for everything except a row's anchor field.
 *
 * A CV that lists a degree with no dates is normal, and failing the whole import
 * over it would be absurd; the review screen shows an empty box and the user
 * fills it if they care. Rows that are blank all the way through are dropped
 * later, in lib/extractor/merge.ts, where "is this worth showing" belongs —
 * keeping this file about shape alone.
 */
const softText = text.default('');
const textList = z.array(text).default([]);

const linksSchema = z.strictObject({
  github: text.optional(),
  linkedin: text.optional(),
  portfolio: text.optional(),
});

const personalSchema = z.strictObject({
  name: text.optional(),
  email: text.optional(),
  phone: text.optional(),
  links: linksSchema.optional(),
});

const educationSchema = z.strictObject({
  institution: softText,
  program: softText,
  dates: softText,
});

const workHistorySchema = z.strictObject({
  company: softText,
  role: softText,
  dates: softText,
  bullets: textList,
});

/**
 * A project minus the two decisions a document cannot make: whether it was solo
 * or a team effort, and how the user likes to talk about it.
 */
const projectSchema = z.strictObject({
  name: softText,
  description: softText,
  techStack: textList,
});

/** Every section optional: a CV that does not say something must omit the key. */
export const EXTRACTED_PROFILE_SCHEMA = z.strictObject({
  personal: personalSchema.optional(),
  education: z.array(educationSchema).optional(),
  workHistory: z.array(workHistorySchema).optional(),
  projectsRaw: z.array(projectSchema).optional(),
  // Plainly optional, not `textList.optional()`: a default on an absent key wins
  // over the optional wrapper, which would turn "the CV said nothing about
  // skills" into "the CV listed none of them".
  skills: z.array(text).optional(),
});

/**
 * Treat `null` as "not stated" anywhere in the response.
 *
 * The instruction and the response schema both say to omit what the CV does not
 * state, and models mostly do — but a null for an absent value is the other
 * common way to say the same thing, and it is not worth failing an import over
 * which one arrived. Applied before validation so the schema itself stays strict
 * about real type errors: a number where a string belongs is still rejected.
 */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null).map(withoutNulls);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== null) out[key] = withoutNulls(item);
    }
    return out;
  }
  return value;
}

/**
 * Parse and validate a raw extraction response into `ExtractedProfileData`.
 *
 * Accepts the response text or an already-parsed value. Throws
 * `ExtractionSchemaError` on anything else — non-JSON, an array, a forbidden
 * key, a wrong type — rather than letting partial data reach the review screen,
 * because a caught error is recoverable (retry, or tell the user) and half an
 * imported profile is not.
 */
export function validateExtractedProfile(raw: unknown): ExtractedProfileData {
  let value: unknown = raw;

  if (typeof raw === 'string') {
    // Models fence their JSON even when told not to; the generator's validator
    // has met the same habit.
    const body = stripCodeFence(raw);
    if (body.length === 0) {
      throw new ExtractionSchemaError('The model returned an empty response');
    }
    try {
      value = JSON.parse(body);
    } catch {
      throw new ExtractionSchemaError('The model response was not valid JSON');
    }
  }

  const result = EXTRACTED_PROFILE_SCHEMA.safeParse(withoutNulls(value));
  if (!result.success) {
    // Path first, so a rejected key reads as `projectsRaw.0: Unrecognized key:
    // "individualOrGroup"` rather than leaving the user to guess where it was.
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.map(String).join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    });
    throw new ExtractionSchemaError(
      'The extracted CV data did not match the expected shape',
      issues,
    );
  }
  return result.data;
}
