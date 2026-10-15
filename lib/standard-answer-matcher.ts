import type { DetectedField, GeneratedAnswer, JobContext, ProfileData } from './types';
import type { Generator, BuiltPrompt } from './generator/types';
import { validateGeneratedAnswers } from './schema-validator';
import { getPromptSettings } from './storage';
import type { PromptSettings } from './prompt-settings';

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
  prompts: PromptSettings,
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
  sections.push(prompts.standardAnswerReminder);

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
  const prompts = await getPromptSettings();

  const prompt: BuiltPrompt = {
    system: prompts.standardAnswerSystem,
    user: buildUserPrompt(fields, promptProfile, context, prompts),
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
