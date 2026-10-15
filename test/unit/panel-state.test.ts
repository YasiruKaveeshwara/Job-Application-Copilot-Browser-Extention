import { describe, it, expect } from 'vitest';
import {
  canSaveCorrection,
  canReviseAnswer,
  correctionBlockedReason,
  countNeedingReview,
  describeBackgroundFailure,
  describePageMessageFailure,
  initialState,
  needsReview,
  panelReducer,
  reviewReasons,
} from '../../entrypoints/sidepanel/state';
import type { FieldCard, PanelAction, PanelState } from '../../entrypoints/sidepanel/state';
import type { ScanResult } from '../../lib/messaging';
import type { DetectedField, GeneratedAnswer, JobContext } from '../../lib/types';

function field(overrides: Partial<DetectedField> = {}): DetectedField {
  return {
    tempId: 'f0',
    resolvedLabel: 'Cover Letter',
    labelConfidence: 'structured',
    elementType: 'textarea',
    domRef: 'jac-1',
    currentValue: '',
    surroundingText: '',
    ...overrides,
  };
}

const context: JobContext = {
  rawText: 'We are hiring a mobile engineer.',
  url: 'https://careers.example.com/apply/42',
  pageTitle: 'Mobile Engineer — Apply',
};

function scan(fields: DetectedField[], overrides: Partial<JobContext> = {}): ScanResult {
  return { fields, context: { ...context, ...overrides } };
}

function answer(overrides: Partial<GeneratedAnswer> = {}): GeneratedAnswer {
  return {
    tempId: 'f0',
    classifiedType: 'cover-letter',
    confidence: 'high',
    draftAnswer: 'I build offline-first mobile apps.',
    ...overrides,
  };
}

/** Run a sequence of actions from the initial state. */
function reduce(...actions: PanelAction[]): PanelState {
  return actions.reduce(panelReducer, initialState);
}

/** The common starting point: one scan, drafts delivered. */
function ready(fields: DetectedField[], answers: GeneratedAnswer[]): PanelState {
  return reduce(
    { type: 'scan-started' },
    { type: 'scan-succeeded', result: scan(fields) },
    { type: 'generation-succeeded', answers },
  );
}

function card(state: PanelState, tempId: string): FieldCard {
  const found = state.cards.find((c) => c.tempId === tempId);
  expect(found, `no card for ${tempId}`).toBeDefined();
  return found!;
}

function cardOf(overrides: Partial<FieldCard> = {}): FieldCard {
  return {
    tempId: 'f0',
    label: 'Cover Letter',
    labelConfidence: 'structured',
    elementType: 'textarea',
    domRef: 'jac-1',
    surroundingText: '',
    classifiedType: 'cover-letter',
    answerSource: 'generated',
    confidence: 'high',
    draft: 'A draft.',
    edited: false,
    insert: { phase: 'idle', error: null },
    correction: { value: '', phase: 'idle', error: null },
    ...overrides,
  };
}

describe('panel phases', () => {
  it('starts with nothing scanned rather than a blank panel', () => {
    expect(initialState.phase).toBe('idle');
    expect(initialState.cards).toEqual([]);
    expect(initialState.error).toBeNull();
  });

  it('shows the detected fields while the drafts are still being generated', () => {
    const state = reduce(
      { type: 'scan-started' },
      { type: 'scan-succeeded', result: scan([field({ tempId: 'f0' }), field({ tempId: 'f1' })]) },
    );

    expect(state.phase).toBe('generating');
    expect(state.cards).toHaveLength(2);
    // No answers yet: nothing is claimed about confidence or classification.
    expect(state.cards.every((c) => c.confidence === null)).toBe(true);
    expect(state.cards.every((c) => c.classifiedType === '')).toBe(true);
  });

  it('distinguishes "no fields on this page" from an error', () => {
    const state = reduce({ type: 'scan-started' }, { type: 'scan-succeeded', result: scan([]) });

    expect(state.phase).toBe('empty');
    expect(state.error).toBeNull();
  });

  it('records the site domain and page title for the header and for corrections', () => {
    const state = reduce(
      { type: 'scan-started' },
      { type: 'scan-succeeded', result: scan([field()]) },
    );

    expect(state.domain).toBe('careers.example.com');
    expect(state.pageTitle).toBe('Mobile Engineer — Apply');
  });

  it('fills each card from its answer, matched by tempId not by position', () => {
    const state = ready(
      [field({ tempId: 'f0', resolvedLabel: 'Cover Letter' }), field({ tempId: 'f1' })],
      [
        answer({ tempId: 'f1', classifiedType: 'motivation', draftAnswer: 'Second.' }),
        answer({ tempId: 'f0', draftAnswer: 'First.' }),
      ],
    );

    expect(state.phase).toBe('ready');
    expect(card(state, 'f0').draft).toBe('First.');
    expect(card(state, 'f1').draft).toBe('Second.');
    expect(card(state, 'f1').classifiedType).toBe('motivation');
  });

  it('keeps a card the generator skipped, with no draft and no invented confidence', () => {
    const state = ready([field({ tempId: 'f0' }), field({ tempId: 'f1' })], [answer()]);

    expect(state.cards).toHaveLength(2);
    expect(card(state, 'f1').draft).toBe('');
    expect(card(state, 'f1').confidence).toBeNull();
  });

  it('shows a scan failure as an error, never as an empty page', () => {
    const state = reduce(
      { type: 'scan-started' },
      { type: 'scan-failed', message: 'Could not reach this page.' },
    );

    expect(state.phase).toBe('error');
    expect(state.error).toBe('Could not reach this page.');
  });

  it('keeps the detected fields when generation fails, so the scan is not lost', () => {
    const state = reduce(
      { type: 'scan-started' },
      { type: 'scan-succeeded', result: scan([field()]) },
      { type: 'generation-failed', message: 'No Gemini API key saved.' },
    );

    expect(state.phase).toBe('error');
    expect(state.error).toBe('No Gemini API key saved.');
    // An editable box the user can type into beats a blank panel.
    expect(state.cards).toHaveLength(1);
  });

  it('clears the previous scan when a new one starts', () => {
    const state = panelReducer(ready([field()], [answer()]), { type: 'scan-started' });

    // Old cards point at DOM refs that may be gone, and a stale draft beside a
    // fresh scan is worse than none.
    expect(state.phase).toBe('scanning');
    expect(state.cards).toEqual([]);
    expect(state.error).toBeNull();
    expect(state.domain).toBe('');
  });
});

describe('answer revision eligibility', () => {
  it('allows revising an AI-drafted answer', () => {
    expect(canReviseAnswer(cardOf())).toBe(true);
  });

  it.each(['name', 'email', 'phone', 'address', 'location'])(
    'does not allow revising static %s fields',
    (classifiedType) => {
      expect(canReviseAnswer(cardOf({ classifiedType }))).toBe(false);
    },
  );

  it('does not allow revising deterministic profile matches', () => {
    expect(canReviseAnswer(cardOf({ answerSource: 'profile' }))).toBe(false);
  });

  it('does not offer revision for static personal-detail labels even if an AI classified them', () => {
    expect(canReviseAnswer(cardOf({ label: 'Name', classifiedType: 'other' }))).toBe(false);
  });

  it('does not offer revision before an answer exists', () => {
    expect(canReviseAnswer(cardOf({ confidence: null }))).toBe(false);
  });
});

describe('editing a draft', () => {
  it('replaces the draft and marks the card edited', () => {
    const state = panelReducer(ready([field()], [answer()]), {
      type: 'draft-changed',
      tempId: 'f0',
      draft: 'My own words.',
    });

    expect(card(state, 'f0').draft).toBe('My own words.');
    expect(card(state, 'f0').edited).toBe(true);
  });

  it('does not overwrite text typed while generation was still running', () => {
    const state = reduce(
      { type: 'scan-started' },
      { type: 'scan-succeeded', result: scan([field()]) },
      { type: 'draft-changed', tempId: 'f0', draft: 'Typed while waiting.' },
      { type: 'generation-succeeded', answers: [answer({ draftAnswer: 'Model draft.' })] },
    );

    expect(card(state, 'f0').draft).toBe('Typed while waiting.');
    // The classification still lands — only the user's text is protected.
    expect(card(state, 'f0').classifiedType).toBe('cover-letter');
  });

  it('drops a stale insert result once the text changes', () => {
    const state = reduce(
      { type: 'scan-started' },
      { type: 'scan-succeeded', result: scan([field()]) },
      { type: 'generation-succeeded', answers: [answer()] },
      { type: 'insert-succeeded', tempId: 'f0' },
      { type: 'draft-changed', tempId: 'f0', draft: 'Changed after inserting.' },
    );

    // "Written into the page" must not sit next to text that is no longer what
    // was written.
    expect(card(state, 'f0').insert.phase).toBe('idle');
  });

  it('touches only the card that changed', () => {
    const state = panelReducer(
      ready(
        [field({ tempId: 'f0' }), field({ tempId: 'f1' })],
        [answer(), answer({ tempId: 'f1' })],
      ),
      { type: 'draft-changed', tempId: 'f0', draft: 'Only mine.' },
    );

    expect(card(state, 'f1').draft).toBe('I build offline-first mobile apps.');
    expect(card(state, 'f1').edited).toBe(false);
  });
});

describe('inserting into the page', () => {
  it('tracks in-flight, success, and failure per card', () => {
    const base = ready([field()], [answer()]);

    expect(
      panelReducer(base, { type: 'insert-started', tempId: 'f0' }).cards[0]!.insert.phase,
    ).toBe('inserting');
    expect(
      panelReducer(base, { type: 'insert-succeeded', tempId: 'f0' }).cards[0]!.insert.phase,
    ).toBe('inserted');

    const failed = panelReducer(base, {
      type: 'insert-failed',
      tempId: 'f0',
      message: 'That field is no longer on the page.',
    });
    expect(failed.cards[0]!.insert.phase).toBe('failed');
    expect(failed.cards[0]!.insert.error).toBe('That field is no longer on the page.');
  });

  it('leaves the panel phase alone: one failed insert is not a page failure', () => {
    const state = panelReducer(ready([field()], [answer()]), {
      type: 'insert-failed',
      tempId: 'f0',
      message: 'nope',
    });

    expect(state.phase).toBe('ready');
    expect(state.error).toBeNull();
  });
});

describe('flagging fields that need review', () => {
  it('flags nothing when the label was structured and the draft was confident', () => {
    expect(reviewReasons(cardOf())).toEqual([]);
    expect(needsReview(cardOf())).toBe(false);
  });

  it('flags a low-confidence draft', () => {
    const reasons = reviewReasons(cardOf({ confidence: 'low' }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/[Ll]ow confidence/);
  });

  it('flags a label guessed from nearby text', () => {
    expect(reviewReasons(cardOf({ labelConfidence: 'proximity' }))[0]).toMatch(/guessed/);
  });

  it('flags a field with no label at all', () => {
    expect(reviewReasons(cardOf({ labelConfidence: 'none', label: '' }))[0]).toMatch(/No label/);
  });

  it('flags a field the generator returned nothing for', () => {
    const reasons = reviewReasons(cardOf({ confidence: null, classifiedType: '', draft: '' }));
    expect(reasons).toEqual(['No draft came back for this field.']);
  });

  it('gives both reasons when the label and the draft are both doubtful', () => {
    expect(reviewReasons(cardOf({ labelConfidence: 'none', confidence: 'low' }))).toHaveLength(2);
  });

  it('counts the cards needing review for the header summary', () => {
    const state = ready(
      [
        field({ tempId: 'f0' }),
        field({ tempId: 'f1', labelConfidence: 'proximity' }),
        field({ tempId: 'f2' }),
      ],
      [answer(), answer({ tempId: 'f1' }), answer({ tempId: 'f2', confidence: 'low' })],
    );

    expect(countNeedingReview(state.cards)).toBe(2);
  });
});

describe('manual label corrections', () => {
  it('accepts a correction and can save it once there is text', () => {
    const state = panelReducer(ready([field()], [answer({ confidence: 'low' })]), {
      type: 'correction-changed',
      tempId: 'f0',
      value: 'work-authorization',
    });

    expect(card(state, 'f0').correction.value).toBe('work-authorization');
    expect(canSaveCorrection(card(state, 'f0'), state.domain)).toBe(true);
  });

  it('refuses to save an empty or whitespace-only correction', () => {
    expect(canSaveCorrection(cardOf(), 'example.com')).toBe(false);
    expect(
      canSaveCorrection(
        cardOf({ correction: { value: '   ', phase: 'idle', error: null } }),
        'example.com',
      ),
    ).toBe(false);
  });

  it('refuses to save when there is no label to key the mapping on, and says why', () => {
    const unlabelled = cardOf({
      label: '',
      labelConfidence: 'none',
      correction: { value: 'availability', phase: 'idle', error: null },
    });

    expect(canSaveCorrection(unlabelled, 'example.com')).toBe(false);
    expect(correctionBlockedReason(unlabelled, 'example.com')).toMatch(/no label/i);
  });

  it('refuses to save when the page has no domain to key the mapping on', () => {
    const filled = cardOf({ correction: { value: 'availability', phase: 'idle', error: null } });

    expect(canSaveCorrection(filled, '')).toBe(false);
    expect(correctionBlockedReason(filled, '')).toMatch(/per site/i);
  });

  it('explains nothing when the correction is saveable', () => {
    expect(correctionBlockedReason(cardOf(), 'example.com')).toBeNull();
  });

  it('tracks saving, saved, and failed without losing what was typed', () => {
    const typed = panelReducer(ready([field()], [answer()]), {
      type: 'correction-changed',
      tempId: 'f0',
      value: 'availability',
    });

    const saving = panelReducer(typed, { type: 'correction-save-started', tempId: 'f0' });
    expect(saving.cards[0]!.correction).toEqual({
      value: 'availability',
      phase: 'saving',
      error: null,
    });

    expect(
      panelReducer(saving, { type: 'correction-saved', tempId: 'f0' }).cards[0]!.correction.phase,
    ).toBe('saved');

    const failed = panelReducer(saving, {
      type: 'correction-save-failed',
      tempId: 'f0',
      message: 'Could not save the correction.',
    });
    expect(failed.cards[0]!.correction.value).toBe('availability');
    expect(failed.cards[0]!.correction.error).toBe('Could not save the correction.');
  });

  it('resets a stale save result when the correction is retyped', () => {
    const saved = reduce(
      { type: 'scan-started' },
      { type: 'scan-succeeded', result: scan([field()]) },
      { type: 'generation-succeeded', answers: [answer()] },
      { type: 'correction-changed', tempId: 'f0', value: 'availability' },
      { type: 'correction-saved', tempId: 'f0' },
      { type: 'correction-changed', tempId: 'f0', value: 'salary' },
    );

    expect(card(saved, 'f0').correction).toEqual({ value: 'salary', phase: 'idle', error: null });
  });
});

describe('failure messages', () => {
  it('turns a missing content script into instructions the user can follow', () => {
    for (const raw of [
      'Could not establish connection. Receiving end does not exist.',
      'Error: [messaging] No listeners available',
      // What tabs.sendMessage actually produces when no content script replies.
      'No response',
    ]) {
      const message = describePageMessageFailure(new Error(raw));
      expect(message).toMatch(/Reload the tab/);
      // The user is told which pages simply cannot work.
      expect(message).toMatch(/browser pages/i);
    }
  });

  it('keeps a message it cannot improve on, and never renders an empty error', () => {
    expect(describePageMessageFailure(new Error('No active tab to scan.'))).toBe(
      'No active tab to scan.',
    );
    expect(describePageMessageFailure(new Error(''))).toBe('Could not reach this page.');
    expect(describePageMessageFailure('a string')).toBe('Could not reach this page.');
  });

  it("passes the background's already-worded failure straight through", () => {
    expect(
      describeBackgroundFailure(
        new Error('Gemini is rate-limiting this key (HTTP 429). Wait a moment and try again.'),
      ),
    ).toMatch(/HTTP 429/);
  });

  it('falls back to a generic sentence for a thrown non-Error', () => {
    for (const thrown of [undefined, 'boom', new Error('   ')]) {
      expect(describeBackgroundFailure(thrown)).toBe(
        'Could not draft answers. See the extension service worker log for details.',
      );
    }
  });
});
