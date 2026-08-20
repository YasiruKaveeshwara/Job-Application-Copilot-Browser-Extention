import { useCallback, useReducer } from 'react';
import { browser } from '#imports';
import { sendMessage } from '@/lib/messaging';
import type { ScanResult } from '@/lib/messaging';
import {
  countNeedingReview,
  describeBackgroundFailure,
  describePageMessageFailure,
  initialState,
  panelReducer,
} from './state';
import type { FieldCard } from './state';
import { FieldCardView } from './components/FieldCard';
import { Banner, PanelButton } from './components/ui';

/**
 * Scans read the tab's top-level document.
 *
 * The content script runs in every frame, so a message with no frame id reaches
 * all of them and keeps whichever reply comes back first — not deterministic.
 * Addressing the main frame is predictable; fields inside cross-origin iframes
 * are the known limit Phase 16 tests and documents.
 */
const MAIN_FRAME = 0;

async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    throw new Error('No active tab to scan. Focus a page and try again.');
  }
  return tab.id;
}

export default function App() {
  const [state, dispatch] = useReducer(panelReducer, initialState);
  const busy = state.phase === 'scanning' || state.phase === 'generating';
  const flaggedCount = countNeedingReview(state.cards);

  const scan = useCallback(async () => {
    dispatch({ type: 'scan-started' });

    let result: ScanResult;
    try {
      const tabId = await activeTabId();
      result = await sendMessage('TRIGGER_SCAN', undefined, { tabId, frameId: MAIN_FRAME });
    } catch (error) {
      dispatch({ type: 'scan-failed', message: describePageMessageFailure(error) });
      return;
    }
    dispatch({ type: 'scan-succeeded', result });

    // Nothing detected: the reducer is already showing its 'empty' state, and
    // there is nothing to pay a generation for.
    if (result.fields.length === 0) return;

    try {
      const answers = await sendMessage('REQUEST_GENERATION', {
        fields: result.fields,
        context: result.context,
      });
      dispatch({ type: 'generation-succeeded', answers });
    } catch (error) {
      // The background maps every failure to one UI-ready sentence, so this shows
      // the actual cause (missing key, rate limit, wrong model id) rather than a
      // generic apology.
      dispatch({ type: 'generation-failed', message: describeBackgroundFailure(error) });
    }
  }, []);

  const insert = useCallback(async (card: FieldCard) => {
    dispatch({ type: 'insert-started', tempId: card.tempId });
    try {
      const tabId = await activeTabId();
      const result = await sendMessage(
        'INSERT_FIELD',
        { domRef: card.domRef, finalText: card.draft },
        { tabId, frameId: MAIN_FRAME },
      );
      if (result.success) {
        dispatch({ type: 'insert-succeeded', tempId: card.tempId });
      } else {
        dispatch({
          type: 'insert-failed',
          tempId: card.tempId,
          message: result.error ?? 'The field could not be updated.',
        });
      }
    } catch (error) {
      // The message never reached the page — a reloaded extension, or a tab the
      // content script does not run in. Said on the card instead of appearing to
      // do nothing.
      dispatch({
        type: 'insert-failed',
        tempId: card.tempId,
        message: describePageMessageFailure(error),
      });
    }
  }, []);

  const saveCorrection = useCallback(
    async (card: FieldCard) => {
      dispatch({ type: 'correction-save-started', tempId: card.tempId });
      try {
        await sendMessage('SAVE_FIELD_MAPPING', {
          domain: state.domain,
          resolvedLabel: card.label.trim(),
          correctedType: card.correction.value.trim(),
        });
        dispatch({ type: 'correction-saved', tempId: card.tempId });
      } catch {
        // The background refuses an incomplete correction and can fail on
        // storage; either way the card says so rather than showing a tick.
        dispatch({
          type: 'correction-save-failed',
          tempId: card.tempId,
          message: 'Could not save the correction.',
        });
      }
    },
    [state.domain],
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-sm font-semibold">Job Application Copilot</h1>
          <PanelButton variant="primary" onClick={() => void scan()} disabled={busy}>
            {state.phase === 'scanning'
              ? 'Scanning…'
              : state.phase === 'generating'
                ? 'Drafting…'
                : state.cards.length > 0
                  ? 'Rescan'
                  : 'Scan this page'}
          </PanelButton>
        </div>

        {state.pageTitle.length > 0 && (
          <p className="mt-1 truncate text-xs text-gray-500">
            {state.pageTitle}
            {state.domain.length > 0 && ` — ${state.domain}`}
          </p>
        )}

        {state.cards.length > 0 && state.phase !== 'generating' && (
          <p className="mt-1 text-xs text-gray-500">
            {state.cards.length} field{state.cards.length === 1 ? '' : 's'} detected
            {flaggedCount > 0 && `, ${flaggedCount} needing review`}.
          </p>
        )}
      </header>

      <main className="flex-1 space-y-3 p-3">
        {state.error && (
          <Banner tone="error" title="Could not finish">
            <p>{state.error}</p>
            <PanelButton onClick={() => void scan()} disabled={busy}>
              Try again
            </PanelButton>
          </Banner>
        )}

        {state.phase === 'idle' && (
          <Banner tone="info" title="Nothing scanned yet">
            <p>
              Open a job application page and press Scan this page. Nothing is ever submitted for
              you — you insert each answer yourself.
            </p>
          </Banner>
        )}

        {state.phase === 'empty' && (
          <Banner tone="info" title="No fields detected on this page">
            <p>
              No inputs, text areas, or editable elements were found in this page&apos;s main frame.
              A form inside an embedded frame may not be reachable from here.
            </p>
          </Banner>
        )}

        {state.phase === 'scanning' && (
          <Banner tone="info" title="Scanning the page…">
            <p>Reading the form fields and the job description.</p>
          </Banner>
        )}

        {state.phase === 'generating' && (
          <Banner tone="info" title="Drafting answers…">
            <p>
              {state.cards.length} field{state.cards.length === 1 ? '' : 's'} detected. Drafts are
              on their way.
            </p>
          </Banner>
        )}

        {state.cards.length > 0 && (
          <ul className="space-y-3">
            {state.cards.map((card) => (
              <FieldCardView
                key={card.tempId}
                card={card}
                domain={state.domain}
                pending={state.phase === 'generating'}
                onDraftChange={(draft) =>
                  dispatch({ type: 'draft-changed', tempId: card.tempId, draft })
                }
                onInsert={() => void insert(card)}
                onCorrectionChange={(value) =>
                  dispatch({ type: 'correction-changed', tempId: card.tempId, value })
                }
                onSaveCorrection={() => void saveCorrection(card)}
              />
            ))}
          </ul>
        )}
      </main>

      <footer className="border-t border-gray-200 bg-white p-3 text-[11px] text-gray-500">
        Drafts only. This extension never submits a form for you.
      </footer>
    </div>
  );
}
