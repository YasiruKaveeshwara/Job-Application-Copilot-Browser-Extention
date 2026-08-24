import type { DetectedField, GeneratedAnswer, JobContext, ProfileData } from './types';
import type { Generator, BuiltPrompt } from './generator/types';
import { validateGeneratedAnswers } from './schema-validator';

// Semantic matching of detected fields to saved standard answers, followed by
// AI paraphrasing that adapts the user's template to the specific job.
//
// Unlike direct-matcher.ts (which handles static facts like name, email, phone),
// standard answers always pass through AI because:
// 1. The field label may differ from the saved questionPattern (semantic match)
// 2. The saved answer is a template that should be adapted per job application
//    (mention the real job title, company, and relevant requirements)

/**
 * Strip the delimiters so untrusted text cannot escape a fence.
 */
const PAGE_TEXT_OPEN = '<page-text>';
const PAGE_TEXT_CLOSE = '</page-text>';
function fenceSafe(text: string): string {
  return text.split(PAGE_TEXT_OPEN).join('(page-text)').split(PAGE_TEXT_CLOSE).join('(/page-text)');
}

/**
 * Build the system prompt for matching + paraphrasing in a single call.
 *
 * The model receives:
 *   - The list of saved standard answers (patterns + full text)
 *   - The list of detected fields (labels + surrounding text)
 *   - The job context (title, URL, posting text)
 *
 * For each field the model decides: does any standard answer fit this field?
 * If yes, adapt the answer to this specific job. If no, return null.
 */
const SYSTEM_PROMPT = [
  'You are a job application assistant. You will be given:',
  "1. A list of the applicant's SAVED STANDARD ANSWERS (templates they use for common questions)",
  '2. A list of DETECTED FORM FIELDS on a job application page',
  '3. The JOB CONTEXT (title, company, posting text)',
  '',
  '## Your Task',
  'For each detected field, determine if any saved standard answer is semantically',
  'relevant — i.e. the field is asking for the same kind of information the standard',
  'answer provides, even if the exact wording differs.',
  '',
  'Examples of semantic matches:',
  '- Field "Message to hiring team" ↔ saved pattern "Cover Letter"',
  '- Field "Why should we hire you?" ↔ saved pattern "Why do you want to join?"',
  '- Field "Additional information" ↔ saved pattern "Cover Letter" or "Tell us about yourself"',
  '- Field "Work authorization" ↔ saved pattern "Are you authorized to work in [country]?"',
  '',
  'Examples of NON-matches:',
  '- Field "First Name" — this is a factual field, not a standard answer',
  '- Field "Salary expectations" — unless there\'s a saved answer about salary',
  '',
  '## Paraphrasing Rules',
  'When a standard answer matches:',
  '1. Keep the SAME overall structure and paragraph flow as the original',
  '2. Preserve ALL factual claims: dates, company names, technologies, metrics, achievements',
  '3. Adapt generic references to match this specific job:',
  '   - "the position" → the actual job title from the posting',
  '   - "your company" → the actual company name if known',
  "   - Adjust emphasis to highlight skills relevant to this role's requirements",
  "4. Maintain the applicant's original tone and voice",
  '5. Keep the same approximate length (±15%)',
  '6. Do NOT invent new facts, achievements, or experiences not in the original',
  '',
  '## Formatting',
  'For letter-style answers (cover letters, messages to hiring managers, introduction',
  'letters), use proper paragraph structure with clear separation:',
  '- Opening/greeting paragraph (e.g. "Dear Hiring Manager,")',
  '- One or more body paragraphs covering experience and motivation',
  '- Closing paragraph with sign-off (e.g. "Sincerely, [Name]")',
  'Use "\\n\\n" between paragraphs in the JSON draftAnswer string to create paragraph',
  'breaks. Do NOT collapse a multi-paragraph letter into a single paragraph.',
  'For short factual answers (one or two sentences), a single paragraph is fine.',
  '',
  '## Output Format',
  'Return a JSON array and nothing else.',
  'No prose before or after the JSON. No markdown code fences. No explanation.',
  '',
  'Each element describes one field that matched a standard answer:',
  '  {',
  '    "tempId": string,          // copy the field\'s tempId verbatim',
  '    "classifiedType": string,  // "standard-answer"',
  '    "confidence": "high",',
  '    "draftAnswer": string      // the paraphrased answer text',
  '  }',
  '',
  'Only include fields that matched a standard answer. If no fields match, return [].',
  'Use exactly the tempId values given. Never invent a tempId.',
].join('\n');

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build the user section of the prompt.
 */
function buildUserPrompt(
  fields: DetectedField[],
  profile: ProfileData,
  context: JobContext,
): string {
  const sections: string[] = [];

  // Job context
  sections.push('## Job Context');
  if (context.pageTitle.trim().length > 0) {
    sections.push(`Page title: ${collapse(context.pageTitle)}`);
  }
  if (context.url.trim().length > 0) {
    sections.push(`URL: ${collapse(context.url)}`);
  }
  const rawText = collapse(context.rawText);
  if (rawText.length > 0) {
    // Limit job text to keep the prompt focused
    const capped = rawText.length > 2000 ? rawText.slice(0, 2000) + '…' : rawText;
    sections.push('');
    sections.push(`${PAGE_TEXT_OPEN}\n${fenceSafe(capped)}\n${PAGE_TEXT_CLOSE}`);
  }

  // Standard answers
  sections.push('');
  sections.push('## Saved Standard Answers');
  for (let i = 0; i < profile.standardAnswers.length; i++) {
    const sa = profile.standardAnswers[i]!;
    sections.push('');
    sections.push(`### Standard Answer ${i + 1}`);
    sections.push(`Pattern: ${collapse(sa.questionPattern)}`);
    sections.push(`<base-template>`);
    sections.push(sa.answerText.trim());
    sections.push(`</base-template>`);
  }

  // Fields to match
  sections.push('');
  sections.push(`## Detected Fields (${fields.length})`);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const label = collapse(f.resolvedLabel);
    sections.push('');
    sections.push(`### Field ${i + 1}`);
    sections.push(`tempId: ${f.tempId}`);
    sections.push(`Label: ${label.length > 0 ? label : '(no label found)'}`);
    sections.push(`Element type: ${f.elementType}`);

    const surrounding = collapse(f.surroundingText);
    if (surrounding.length > 0 && surrounding !== label) {
      sections.push(`Surrounding text: ${surrounding}`);
    }
  }

  sections.push('');
  sections.push(
    'Now return the JSON array of matched fields (only those that matched a saved standard answer), and nothing else.',
  );

  return sections.join('\n');
}

/**
 * Semantically match detected fields against saved standard answers and
 * paraphrase matched answers to fit the specific job application.
 *
 * Returns a map of `tempId → GeneratedAnswer` for fields that matched.
 * Fields with no match are absent from the map.
 *
 * Requires a single AI call. Returns an empty map when:
 * - There are no standard answers saved
 * - There are no fields to match
 * - The generator fails (error is propagated)
 */
export async function matchAndParaphraseStandardAnswers(
  fields: DetectedField[],
  profile: ProfileData,
  context: JobContext,
  generator: Generator,
): Promise<Record<string, GeneratedAnswer>> {
  // Nothing to match against — skip the API call entirely.
  if (
    !Array.isArray(profile.standardAnswers) ||
    profile.standardAnswers.length === 0 ||
    fields.length === 0
  ) {
    return {};
  }

  // Filter to only standard answers that have both pattern and text.
  const validAnswers = profile.standardAnswers.filter(
    (sa) => sa.questionPattern.trim().length > 0 && sa.answerText.trim().length > 0,
  );
  if (validAnswers.length === 0) return {};

  // Build a profile subset with only valid standard answers for the prompt.
  const promptProfile: ProfileData = {
    ...profile,
    standardAnswers: validAnswers,
  };

  const prompt: BuiltPrompt = {
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(fields, promptProfile, context),
    fields: fields.map((f) => ({
      tempId: f.tempId,
      resolvedLabel: f.resolvedLabel,
      elementType: f.elementType,
    })),
  };

  const raw = await generator.generate(prompt);
  const validated = validateGeneratedAnswers(raw);

  // Build the map, keeping only answers for fields that were actually asked about.
  const validTempIds = new Set(fields.map((f) => f.tempId));
  const result: Record<string, GeneratedAnswer> = {};
  for (const answer of validated) {
    if (validTempIds.has(answer.tempId) && !result[answer.tempId]) {
      result[answer.tempId] = answer;
    }
  }
  return result;
}
