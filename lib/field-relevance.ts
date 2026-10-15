import type { DetectedField, JobContext } from './types';
import { callGemini } from './gemini-client';
import { getPromptSettings } from './storage';

// Two-layer relevance filter that reduces detected fields to only those that
// belong to a job application form. Runs after the hard element-type filter in
// field-detector.ts and before the generation prompt is built.
//
// Layer 1 — heuristic: fast, no API call, catches obvious non-application fields.
// Layer 2 — AI:        sends surviving field labels to Gemini for classification.

// ---------------------------------------------------------------------------
// Layer 1: label-based heuristic
// ---------------------------------------------------------------------------

/**
 * Patterns that strongly indicate a field is NOT part of a job application.
 * Tested case-insensitively against the resolved label and surrounding text.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  // Site navigation / search
  /\bsearch\b/i,
  /\bfilter\b/i,
  /\bsort\b/i,
  /\bfind\b/i,
  // Newsletter / marketing
  /\bnewsletter\b/i,
  /\bsubscribe\b/i,
  /\bunsubscribe\b/i,
  /\bpromo\s*code\b/i,
  /\bcoupon\b/i,
  /\bdiscount\b/i,
  // Auth / account
  /\blog\s*in\b/i,
  /\bsign\s*in\b/i,
  /\bsign\s*up\b/i,
  /\bpassword\b/i,
  /\bforgot\b/i,
  /\bcreate\s+account\b/i,
  /\bregister\b/i,
  // Cookie / consent
  /\bcookie\b/i,
  /\bconsent\b/i,
  /\bcaptcha\b/i,
  // Chat / feedback / comment — site features, not application fields
  /\bchat\b/i,
  /\bfeedback\b/i,
  /\bcomment\b/i,
  /\breview\b/i,
  // Quantity / cart / checkout
  /\bquantity\b/i,
  /\bcart\b/i,
  /\bcheckout\b/i,
  /\bpayment\b/i,
  /\bcredit\s+card\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Fast heuristic pass. Returns the subset of fields whose labels do NOT match
 * common non-application patterns.
 *
 * This is deliberately fail-open: a field that matches neither the exclude list
 * nor any known-good pattern is kept. Better to show one extra field than to
 * hide one the user needs.
 */
export function filterByHeuristic(fields: DetectedField[]): DetectedField[] {
  return fields.filter((field) => {
    const label = field.resolvedLabel.toLowerCase();
    const context = field.surroundingText.toLowerCase();
    // If the label OR the surrounding text matches an exclusion pattern, drop it.
    return !matchesAny(label, EXCLUDE_PATTERNS) && !matchesAny(context, EXCLUDE_PATTERNS);
  });
}

// ---------------------------------------------------------------------------
// Layer 2: AI-powered relevance classification
// ---------------------------------------------------------------------------

/** The structured output schema for the AI relevance filter response. */
const RELEVANCE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    relevant: {
      type: 'ARRAY',
      description: 'The tempId values of fields that are part of the job application form.',
      items: { type: 'STRING' },
    },
  },
  required: ['relevant'],
};

/**
 * Build a compact summary of each field for the AI to classify.
 * Keeps the prompt small to minimise latency and cost.
 */
function buildFieldSummary(field: DetectedField): string {
  const parts = [`  tempId: ${field.tempId}`];
  const label = field.resolvedLabel.trim();
  if (label.length > 0) parts.push(`  label: ${label}`);
  parts.push(`  type: ${field.elementType}`);
  // Include a short snippet of surrounding text for context, capped at 120 chars.
  const surrounding = field.surroundingText.trim().slice(0, 120);
  if (surrounding.length > 0) parts.push(`  context: ${surrounding}`);
  return parts.join('\n');
}

/**
 * Ask Gemini which of the given fields are relevant to a job application.
 *
 * Returns the subset of `fields` whose tempIds appear in the model's response.
 * On any failure (no API key, network, bad response), returns all fields
 * unchanged — the AI layer is additive, never destructive.
 */
export async function filterByAI(
  fields: DetectedField[],
  jobContext: JobContext,
): Promise<DetectedField[]> {
  if (fields.length === 0) return [];

  try {
    const prompts = await getPromptSettings();
    const fieldDescriptions = fields.map(buildFieldSummary).join('\n---\n');
    const userPrompt = [
      `## Page context`,
      `Title: ${jobContext.pageTitle}`,
      `URL: ${jobContext.url}`,
      '',
      `## Detected fields (${fields.length})`,
      fieldDescriptions,
      '',
      prompts.fieldRelevanceReminder,
    ].join('\n');

    const text = await callGemini({
      systemInstruction: { parts: [{ text: prompts.fieldRelevanceSystem }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RELEVANCE_SCHEMA,
        // Small response: just a list of IDs.
        maxOutputTokens: 1024,
      },
    });

    const parsed = JSON.parse(text) as { relevant?: string[] };
    const relevant = parsed.relevant;
    if (!Array.isArray(relevant)) return fields;

    const relevantSet = new Set(relevant);
    const filtered = fields.filter((f) => relevantSet.has(f.tempId));

    // If the AI returned nothing relevant, fall back to showing everything —
    // an empty panel is worse than a noisy one.
    return filtered.length > 0 ? filtered : fields;
  } catch {
    // AI layer is best-effort. On failure, pass all fields through.
    return fields;
  }
}
