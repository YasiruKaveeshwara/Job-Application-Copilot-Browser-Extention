import type { GeneratedAnswer } from './types';
import type { GenerationRequest } from './messaging';
import type { Generator } from './generator/types';
import { GeneratorError } from './generator/types';
import { getGenerator } from './generator';
import { getProfile, getSettings } from './storage';
import { correctionHints } from './mapping-cache';
import { answerCacheKeys, readCachedAnswers, writeCachedAnswers } from './cache';
import type { CacheInputs } from './cache';
import { retrieveFragments } from './retrieval';
import { buildPrompt } from './prompt-builder';
import { validateGeneratedAnswers } from './schema-validator';

// The one path from "here are the fields on this page" to "here are the drafts".
// Lives in lib/ rather than in the background entrypoint so it can be tested
// directly as well as through a message (build guide, section 0, rule 6).

/**
 * Messages the UI is allowed to show. Every failure below is mapped to one of
 * these before it leaves the background: a raw provider payload, a stack trace,
 * or an unparsed model response must never surface as UI text.
 */
const GENERIC_FAILURE =
  'Could not draft answers. See the extension service worker log for details.';

/** Turn any thrown value into one clean sentence for the panel. */
export function describeGenerationFailure(error: unknown): string {
  if (!(error instanceof GeneratorError)) return GENERIC_FAILURE;

  switch (error.kind) {
    case 'config':
      // A config error is raised before anything is sent, and the generator
      // already words it as an instruction ("Add one on the options page").
      return error.message;
    case 'network':
      return 'Could not reach the Gemini API. Check your connection and try again.';
    case 'http':
      return describeHttpFailure(error);
    case 'response':
      // The generator's message describes the *shape* of the problem (blocked,
      // truncated, schema mismatch) and never quotes the model's raw output.
      return `${error.message} Try again.`;
    default:
      return GENERIC_FAILURE;
  }
}

function describeHttpFailure(error: GeneratorError): string {
  const status = error.status;
  if (status === 400) {
    return 'Gemini rejected the request (HTTP 400). The model ID in the extension options may be wrong.';
  }
  if (status === 401 || status === 403) {
    return `Gemini rejected the API key (HTTP ${status}). Check the key in the extension options.`;
  }
  if (status === 404) {
    return 'Gemini does not recognise that model (HTTP 404). Pick another model in the extension options.';
  }
  if (status === 429) {
    return 'Gemini is rate-limiting this key (HTTP 429). Wait a moment and try again.';
  }
  if (status !== undefined && status >= 500) {
    return `Gemini had a server error (HTTP ${status}). Try again shortly.`;
  }
  return `Gemini returned HTTP ${status ?? 'error'}. Try again.`;
}

/**
 * Keep only answers that belong to a field that was asked about, one per field,
 * in the order the fields were sent.
 *
 * A hallucinated or duplicated `tempId` is dropped rather than treated as a
 * whole-page failure: one bad id should not cost the user every other draft. A
 * field the model skipped simply has no answer — nothing is fabricated to fill
 * the gap, and the panel renders a card for it either way.
 */
function reconcile(
  answers: GeneratedAnswer[],
  fields: GenerationRequest['fields'],
): GeneratedAnswer[] {
  const byId = new Map<string, GeneratedAnswer>();
  for (const answer of answers) {
    if (!byId.has(answer.tempId)) byId.set(answer.tempId, answer);
  }
  return fields
    .map((field) => byId.get(field.tempId))
    .filter((answer): answer is GeneratedAnswer => answer !== undefined);
}

/**
 * Retrieve, prompt, generate, validate.
 *
 * Rejects with a UI-ready message on any failure; the caller never sees a
 * provider error object or an unvalidated response. The generator is a parameter
 * so tests can inject `MockGenerator` without touching the message layer.
 */
export async function generateAnswers(
  request: GenerationRequest,
  generator: Generator = getGenerator(),
): Promise<GeneratedAnswer[]> {
  // No fields means no prompt and no spend. Not an error: a page with no form
  // is the common case, and the panel has a state for it.
  if (request.fields.length === 0) return [];

  try {
    const profile = await getProfile();
    const fragmentsByField: Record<string, string[]> = {};
    for (const field of request.fields) {
      fragmentsByField[field.tempId] = retrieveFragments(field, request.context, profile);
    }

    // Saved corrections, applied only after the generic detector has run, and
    // only as a hint in the prompt (build guide, Phase 14).
    const hintsByField = await correctionHints(request.fields, request.context.url);

    // What has already been paid for. The key covers everything above plus the
    // model, so a hit means the same question, the same profile material, and the
    // same model as last time (build guide, Phase 15).
    const { modelId } = await getSettings();
    const cacheInputs: CacheInputs[] = request.fields.map((field) => ({
      field,
      context: request.context,
      fragments: fragmentsByField[field.tempId] ?? [],
      style: profile.stylePreferences,
      hint: hintsByField[field.tempId] ?? '',
      modelId,
    }));
    const keys = await answerCacheKeys(cacheInputs);
    const cached = await readCachedAnswers(keys);

    const missing = request.fields.filter((field) => cached[field.tempId] === undefined);
    // Every field answered from cache: no prompt, no request, no key needed.
    if (missing.length === 0) return reconcile(Object.values(cached), request.fields);

    const prompt = buildPrompt(
      missing,
      request.context,
      fragmentsByField,
      profile.stylePreferences,
      hintsByField,
    );

    // Validated again here even though GeminiGenerator already validates: this is
    // the boundary the UI trusts, and it must hold for any Generator, including
    // one written later that returns whatever its provider handed back.
    const validated = validateGeneratedAnswers(await generator.generate(prompt));
    const fresh = reconcile(validated, missing);
    // After the answers are in hand, and never in a way that can fail the call.
    await writeCachedAnswers(keys, fresh);
    return reconcile([...Object.values(cached), ...fresh], request.fields);
  } catch (error) {
    // The full error (stack, cause, provider detail) goes to the service worker
    // log; only the mapped sentence crosses back to the UI. Never log the prompt
    // — it contains the user's profile — or the API key.
    console.error('[job-copilot] generation failed', error);
    // `cause` is kept for a developer reading the panel's console: none of the
    // error messages in this chain quote the model's raw output, so nothing
    // unvalidated travels with it.
    throw new Error(describeGenerationFailure(error), { cause: error });
  }
}
