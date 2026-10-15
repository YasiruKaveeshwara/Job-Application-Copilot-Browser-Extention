import type { DetectedField, GeneratedAnswer } from '@/lib/types';
import type { ScanResult } from '@/lib/messaging';
import { extractDomain } from '@/lib/job-context';

// The review panel's state machine, kept out of the component so it can be
// tested directly (build guide, section 0, rule 6). Nothing here touches the
// DOM, storage, or messaging: App.tsx sends the messages and dispatches the
// results, this module decides what the panel then shows.

/** What the panel is doing, and therefore which screen it shows. */
export type PanelPhase =
  /** Nothing requested yet: the user has not pressed Scan. */
  | 'idle'
  /** Asking the content script what is on the page. */
  | 'scanning'
  /** Fields are known and on screen; drafts are still being generated. */
  | 'generating'
  /** Drafts are in. */
  | 'ready'
  /** The scan succeeded and found nothing. Distinct from an error. */
  | 'empty'
  /** Something failed. `error` is always set, so the panel is never blank. */
  | 'error';

export type InsertPhase = 'idle' | 'inserting' | 'inserted' | 'failed';
export type SavePhase = 'idle' | 'saving' | 'saved' | 'failed';

/** One detected field, plus its draft and everything the user has done to it. */
export interface FieldCard {
  tempId: string;
  /** The detector's resolved label; '' when it could not find one. */
  label: string;
  labelConfidence: DetectedField['labelConfidence'];
  elementType: string;
  domRef: string;
  surroundingText: string;
  /** The generator's classification, or '' before/without an answer. */
  classifiedType: string;
  answerSource: 'profile' | 'generated' | null;
  /** null means no answer came back for this field at all. */
  confidence: 'high' | 'low' | null;
  /** Contents of the editable area: the draft, or what the user typed over it. */
  draft: string;
  edited: boolean;
  insert: { phase: InsertPhase; error: string | null };
  /** Manual "this field is really asking for X" correction (SAVE_FIELD_MAPPING). */
  correction: { value: string; phase: SavePhase; error: string | null };
}

export interface PanelState {
  phase: PanelPhase;
  /** Non-null whenever something failed; the UI must show it, not swallow it. */
  error: string | null;
  /** Site domain, for keying a saved correction. */
  domain: string;
  pageTitle: string;
  cards: FieldCard[];
}

export const initialState: PanelState = {
  phase: 'idle',
  error: null,
  domain: '',
  pageTitle: '',
  cards: [],
};

export type PanelAction =
  | { type: 'scan-started' }
  | { type: 'scan-succeeded'; result: ScanResult }
  | { type: 'scan-failed'; message: string }
  | { type: 'generation-succeeded'; answers: GeneratedAnswer[] }
  | { type: 'generation-failed'; message: string }
  | { type: 'draft-changed'; tempId: string; draft: string }
  | { type: 'insert-started'; tempId: string }
  | { type: 'insert-succeeded'; tempId: string }
  | { type: 'insert-failed'; tempId: string; message: string }
  | { type: 'correction-changed'; tempId: string; value: string }
  | { type: 'correction-save-started'; tempId: string }
  | { type: 'correction-saved'; tempId: string }
  | { type: 'correction-save-failed'; tempId: string; message: string };

function toCard(field: DetectedField): FieldCard {
  return {
    tempId: field.tempId,
    label: field.resolvedLabel,
    labelConfidence: field.labelConfidence,
    elementType: field.elementType,
    domRef: field.domRef,
    surroundingText: field.surroundingText,
    classifiedType: '',
    answerSource: null,
    confidence: null,
    // Pre-filled with whatever the page already had, so inserting is never
    // destructive by accident before a draft arrives.
    draft: field.currentValue,
    edited: false,
    insert: { phase: 'idle', error: null },
    correction: { value: '', phase: 'idle', error: null },
  };
}

function applyAnswer(card: FieldCard, answer: GeneratedAnswer | undefined): FieldCard {
  if (!answer) return card;
  return {
    ...card,
    classifiedType: answer.classifiedType,
    confidence: answer.confidence,
    answerSource: answer.source ?? 'generated',
    // If the user started typing while generation was still running, their text
    // wins: an arriving draft must never overwrite something they wrote.
    draft: card.edited ? card.draft : answer.draftAnswer,
  };
}

function mapCard(
  state: PanelState,
  tempId: string,
  change: (card: FieldCard) => FieldCard,
): PanelState {
  return {
    ...state,
    cards: state.cards.map((card) => (card.tempId === tempId ? change(card) : card)),
  };
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'scan-started':
      // Start clean. Cards from the previous scan point at DOM refs that may no
      // longer exist, and a stale draft beside a fresh scan is worse than none.
      return { ...initialState, phase: 'scanning' };

    case 'scan-succeeded': {
      const cards = action.result.fields.map(toCard);
      return {
        // Fields are shown as soon as they are known, before the drafts land.
        phase: cards.length === 0 ? 'empty' : 'generating',
        error: null,
        domain: extractDomain(action.result.context.url),
        pageTitle: action.result.context.pageTitle,
        cards,
      };
    }

    case 'scan-failed':
      return { ...state, phase: 'error', error: action.message };

    case 'generation-succeeded': {
      const byId = new Map(action.answers.map((answer) => [answer.tempId, answer]));
      return {
        ...state,
        phase: 'ready',
        error: null,
        cards: state.cards.map((card) => applyAnswer(card, byId.get(card.tempId))),
      };
    }

    case 'generation-failed':
      // The cards stay. The fields were genuinely detected, and an empty text
      // area the user can write in beats losing the scan to a blank panel.
      return { ...state, phase: 'error', error: action.message };

    case 'draft-changed':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        draft: action.draft,
        edited: true,
        // A previous insert result no longer describes what is in the box.
        insert: { phase: 'idle', error: null },
      }));

    case 'insert-started':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        insert: { phase: 'inserting', error: null },
      }));

    case 'insert-succeeded':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        insert: { phase: 'inserted', error: null },
      }));

    case 'insert-failed':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        insert: { phase: 'failed', error: action.message },
      }));

    case 'correction-changed':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        correction: { value: action.value, phase: 'idle', error: null },
      }));

    case 'correction-save-started':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        correction: { ...card.correction, phase: 'saving', error: null },
      }));

    case 'correction-saved':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        correction: { ...card.correction, phase: 'saved', error: null },
      }));

    case 'correction-save-failed':
      return mapCard(state, action.tempId, (card) => ({
        ...card,
        correction: { ...card.correction, phase: 'failed', error: action.message },
      }));
  }
}

/**
 * Why this card needs a human look, in words the user can act on.
 *
 * Empty means the field was confidently labelled and confidently drafted. Every
 * other case is surfaced on the card — a low-confidence draft or a guessed label
 * is never hidden or presented as if it were trustworthy (build guide, Phase 12).
 */
export function reviewReasons(card: FieldCard): string[] {
  const reasons: string[] = [];

  if (card.labelConfidence === 'none') {
    reasons.push('No label found for this field, so the draft is a guess at what it asks for.');
  } else if (card.labelConfidence === 'proximity') {
    reasons.push('Label was guessed from nearby text and may be the wrong question.');
  }

  if (card.confidence === null) {
    reasons.push('No draft came back for this field.');
  } else if (card.confidence === 'low') {
    reasons.push('Low confidence: check this against your own history before sending it.');
  }

  return reasons;
}

export function needsReview(card: FieldCard): boolean {
  return reviewReasons(card).length > 0;
}

export function countNeedingReview(cards: FieldCard[]): number {
  return cards.filter(needsReview).length;
}

const STATIC_ANSWER_TYPES = new Set([
  'address',
  'city',
  'company',
  'country',
  'date-of-birth',
  'degree',
  'education',
  'email',
  'github',
  'linkedin',
  'location',
  'name',
  'phone',
  'postal-code',
  'state',
  'university',
  'url',
  'website',
  'zip-code',
]);

const STATIC_ANSWER_LABEL =
  /\b(name|address|email|e-mail|first name|last name|full name|phone|telephone|mobile|postal code|zip code|date of birth|birth date|linkedin|github|portfolio|website|university|degree)\b/i;

/** Static profile facts should remain verbatim and do not need AI revision. */
export function canReviseAnswer(card: FieldCard): boolean {
  if (
    card.answerSource === 'profile' ||
    card.confidence === null ||
    card.draft.trim().length === 0
  ) {
    return false;
  }

  if (STATIC_ANSWER_TYPES.has(card.classifiedType.trim().toLowerCase())) return false;
  return !STATIC_ANSWER_LABEL.test(card.label);
}

/**
 * Whether a correction can be saved.
 *
 * The learned mapping is keyed by `(domain, resolvedLabel)`, so a field with no
 * resolved label has no key to remember anything against, and a blank correction
 * has nothing to remember. Both are refused in the UI rather than sent and
 * silently dropped by the cache.
 */
export function canSaveCorrection(card: FieldCard, domain: string): boolean {
  return (
    domain.length > 0 && card.label.trim().length > 0 && card.correction.value.trim().length > 0
  );
}

/** Explain, if a correction cannot be saved, what is missing. */
export function correctionBlockedReason(card: FieldCard, domain: string): string | null {
  if (card.label.trim().length === 0) {
    return 'Corrections are remembered per label, and this field has no label to remember against.';
  }
  if (domain.length === 0)
    return 'Corrections are remembered per site, and this page has no domain.';
  return null;
}

/**
 * Turn a failed `TRIGGER_SCAN` / `INSERT_FIELD` into something actionable.
 *
 * The usual cause is that no content script is running in the tab: a browser
 * page, the Web Store, a PDF viewer, or a tab that was already open when the
 * extension was installed or reloaded. `tabs.sendMessage` reports that as a
 * missing reply ("No response") rather than as a connection error, so both
 * wordings are matched.
 */
export function describePageMessageFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (
    /receiving end does not exist|could not establish connection|no listeners|no response/i.test(
      message,
    )
  ) {
    return 'Could not reach this page. Reload the tab and try again — browser pages, the Web Store, and PDF views cannot be scanned.';
  }
  return message.length > 0 ? message : 'Could not reach this page.';
}

/** The background already words its failures for the UI; pass them through. */
export function describeBackgroundFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  return message.length > 0
    ? message
    : 'Could not draft answers. See the extension service worker log for details.';
}
