import { useCallback, useReducer, useState } from 'react';
import { browser } from '#imports';
import { sendMessage } from '@/lib/messaging';
import type { ScanResult } from '@/lib/messaging';
import { filterByHeuristic } from '@/lib/field-relevance';
import { log } from '@/lib/log';
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
import { SettingsView } from './components/SettingsView';
import { LogView } from './components/LogView';

/**
 * Scans read the tab's top-level document.
 * Addressing the main frame is predictable.
 */
const MAIN_FRAME = 0;

async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    throw new Error('No active tab to scan. Focus a page and try again.');
  }
  return tab.id;
}

type PanelView = 'scan' | 'settings' | 'log';

// Diagnostic initial log
log('info', 'panel', 'Side panel loaded.');

export default function App() {
  const [view, setView] = useState<PanelView>('scan');
  const [state, dispatch] = useReducer(panelReducer, initialState);
  const busy = state.phase === 'scanning' || state.phase === 'generating';
  const flaggedCount = countNeedingReview(state.cards);

  const scan = useCallback(async () => {
    dispatch({ type: 'scan-started' });
    log('info', 'scan', 'Scan started — querying active tab.');

    let tabId: number;
    try {
      tabId = await activeTabId();
      log('debug', 'scan', `Active tab id: ${tabId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log('error', 'scan', `Failed to get active tab: ${msg}`, error);
      dispatch({ type: 'scan-failed', message: msg });
      return;
    }

    // Check that the tab has a URL the content script can run on.
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? '(unknown)';
      log('info', 'scan', `Tab URL: ${url}`);
      if (/^(chrome|edge|brave|about|chrome-extension):/.test(url)) {
        const msg = `Cannot scan browser-internal pages (${url}). Open a regular job application page.`;
        log('warn', 'scan', msg);
        dispatch({ type: 'scan-failed', message: msg });
        return;
      }
    } catch {
      log('debug', 'scan', 'Could not read tab URL; continuing with scan.');
    }

    let result: ScanResult;
    try {
      log('debug', 'scan', `Sending TRIGGER_SCAN to tab ${tabId}, frame ${MAIN_FRAME}`);
      result = await sendMessage('TRIGGER_SCAN', undefined, { tabId, frameId: MAIN_FRAME });
      log(
        'info',
        'scan',
        `Scan succeeded: ${result.fields.length} field(s), page title "${result.context.pageTitle}"`,
      );
    } catch (firstError) {
      // Auto-inject content script if connection failed
      const raw = firstError instanceof Error ? firstError.message : String(firstError);
      const isConnectionError =
        /receiving end does not exist|could not establish connection|no response/i.test(raw);

      if (isConnectionError) {
        log(
          'warn',
          'scan',
          'Content script not found — injecting it programmatically and retrying.',
        );
        try {
          await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ['content-scripts/content.js'],
          });
          log('debug', 'scan', 'Content script injected. Retrying TRIGGER_SCAN.');
          await new Promise((r) => setTimeout(r, 100));
          result = await sendMessage('TRIGGER_SCAN', undefined, { tabId, frameId: MAIN_FRAME });
          log(
            'info',
            'scan',
            `Scan succeeded on retry: ${result.fields.length} field(s), page title "${result.context.pageTitle}"`,
          );
        } catch (retryError) {
          const retryRaw = retryError instanceof Error ? retryError.message : String(retryError);
          const friendly = describePageMessageFailure(retryError);
          log('error', 'scan', `TRIGGER_SCAN failed after injection: ${retryRaw}`, retryError);
          dispatch({ type: 'scan-failed', message: friendly });
          return;
        }
      } else {
        const friendly = describePageMessageFailure(firstError);
        log('error', 'scan', `TRIGGER_SCAN failed: ${raw}`, firstError);
        dispatch({ type: 'scan-failed', message: friendly });
        return;
      }
    }

    // --- Relevance filtering (3 layers) ---
    // Layer 1 (hard element-type) already ran in the content script's detector.
    const rawCount = result.fields.length;

    // Layer 2: fast heuristic — drop obvious non-application fields by label.
    const heuristicFiltered = filterByHeuristic(result.fields);
    const heuristicDropped = rawCount - heuristicFiltered.length;
    if (heuristicDropped > 0) {
      log(
        'info',
        'filter',
        `Heuristic filter removed ${heuristicDropped} non-application field(s) (${rawCount} → ${heuristicFiltered.length}).`,
      );
    }

    // Layer 3: AI classification — ask Gemini which surviving fields are application-relevant.
    let relevantFields = heuristicFiltered;
    if (heuristicFiltered.length > 0) {
      try {
        log('info', 'filter', `Asking AI to classify ${heuristicFiltered.length} field(s)…`);
        relevantFields = await sendMessage('FILTER_RELEVANCE', {
          fields: heuristicFiltered,
          context: result.context,
        });
        const aiDropped = heuristicFiltered.length - relevantFields.length;
        if (aiDropped > 0) {
          log(
            'info',
            'filter',
            `AI filter removed ${aiDropped} more field(s) (${heuristicFiltered.length} → ${relevantFields.length}).`,
          );
        }
      } catch (error) {
        // AI layer is best-effort; on failure, use heuristic result.
        log(
          'warn',
          'filter',
          `AI relevance filter failed, using heuristic result: ${error instanceof Error ? error.message : String(error)}`,
        );
        relevantFields = heuristicFiltered;
      }
    }

    // Replace the scan result with filtered fields
    const filteredResult: ScanResult = { ...result, fields: relevantFields };
    const totalDropped = rawCount - relevantFields.length;
    if (totalDropped > 0) {
      log(
        'info',
        'filter',
        `Total: ${totalDropped} of ${rawCount} field(s) filtered out. Showing ${relevantFields.length}.`,
      );
    }

    dispatch({ type: 'scan-succeeded', result: filteredResult });

    if (filteredResult.fields.length === 0) {
      log('info', 'scan', 'No relevant application fields found on this page.');
      return;
    }

    log('info', 'generate', `Requesting drafts for ${filteredResult.fields.length} field(s)…`);
    try {
      const answers = await sendMessage('REQUEST_GENERATION', {
        fields: filteredResult.fields,
        context: filteredResult.context,
      });
      log('info', 'generate', `Generation succeeded: ${answers.length} answer(s) returned.`);
      dispatch({ type: 'generation-succeeded', answers });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const friendly = describeBackgroundFailure(error);
      log('error', 'generate', `REQUEST_GENERATION failed: ${raw}`, error);
      dispatch({ type: 'generation-failed', message: friendly });
    }
  }, []);

  const insert = useCallback(async (card: FieldCard) => {
    dispatch({ type: 'insert-started', tempId: card.tempId });
    log('info', 'insert', `Inserting into "${card.label}" (domRef: ${card.domRef})`);
    try {
      const tabId = await activeTabId();
      const result = await sendMessage(
        'INSERT_FIELD',
        { domRef: card.domRef, finalText: card.draft },
        { tabId, frameId: MAIN_FRAME },
      );
      if (result.success) {
        log('info', 'insert', `Insert succeeded for "${card.label}".`);
        dispatch({ type: 'insert-succeeded', tempId: card.tempId });
      } else {
        const msg = result.error ?? 'The field could not be updated.';
        log('warn', 'insert', `Insert failed for "${card.label}": ${msg}`);
        dispatch({ type: 'insert-failed', tempId: card.tempId, message: msg });
      }
    } catch (error) {
      const msg = describePageMessageFailure(error);
      log(
        'error',
        'insert',
        `INSERT_FIELD failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
      dispatch({
        type: 'insert-failed',
        tempId: card.tempId,
        message: msg,
      });
    }
  }, []);

  const saveCorrection = useCallback(
    async (card: FieldCard) => {
      dispatch({ type: 'correction-save-started', tempId: card.tempId });
      log(
        'info',
        'correction',
        `Saving correction for "${card.label}" → "${card.correction.value}" on ${state.domain}`,
      );
      try {
        await sendMessage('SAVE_FIELD_MAPPING', {
          domain: state.domain,
          resolvedLabel: card.label.trim(),
          correctedType: card.correction.value.trim(),
        });
        log('info', 'correction', 'Correction saved.');
        dispatch({ type: 'correction-saved', tempId: card.tempId });
      } catch (error) {
        log(
          'error',
          'correction',
          `SAVE_FIELD_MAPPING failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
        );
        dispatch({
          type: 'correction-save-failed',
          tempId: card.tempId,
          message: 'Could not save the correction.',
        });
      }
    },
    [state.domain],
  );

  // Settings view
  if (view === 'settings') {
    return <SettingsView onBack={() => setView('scan')} />;
  }

  // Diagnostics Log view
  if (view === 'log') {
    return <LogView onBack={() => setView('scan')} />;
  }

  // Main Scan view
  return (
    <div className="flex min-h-screen flex-col bg-slate-50/80 text-slate-900 font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 p-3 shadow-2xs backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          {/* Logo Branding */}
          <div className="flex items-center gap-2">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 shadow-sm shadow-indigo-500/25">
              {/* Paperplane star icon */}
              <svg
                className="h-4 w-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m22 2-7 20-4-9-9-4Z" />
                <path d="M22 2 11 13" />
              </svg>
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
              </span>
            </div>
            <div>
              <h1 className="text-xs font-extrabold tracking-tight text-slate-900 leading-none">
                Job Copilot
              </h1>
              <span className="text-[10px] font-semibold text-indigo-600 font-mono tracking-wide">
                AI AUTOFILL
              </span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5">
            {/* Logs button */}
            <button
              type="button"
              onClick={() => setView('log')}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Open diagnostic log"
              title="Diagnostics & Logs"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25ZM2.5 5.25a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75v-9.5Zm3.75 3a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5h-7.5Zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-4.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Settings button */}
            <button
              type="button"
              onClick={() => setView('settings')}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Open settings"
              title="Profile & AI Settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Scan Button */}
            <PanelButton variant="primary" onClick={() => void scan()} disabled={busy}>
              {state.phase === 'scanning' ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    ></path>
                  </svg>
                  Scanning…
                </span>
              ) : state.phase === 'generating' ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    ></path>
                  </svg>
                  Drafting…
                </span>
              ) : state.cards.length > 0 ? (
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.451a.75.75 0 0 0 0-1.5H4.5a.75.75 0 0 0-.75.75v3.75a.75.75 0 0 0 1.5 0v-2.19l.312.312a7 7 0 0 0 11.712-3.137.75.75 0 0 0-1.962-.29ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466l.312.311H11.75a.75.75 0 0 0 0 1.5h3.75a.75.75 0 0 0 .75-.75V3.421a.75.75 0 0 0-1.5 0v2.19l-.312-.312A7 7 0 0 0 2.726 8.436a.75.75 0 0 0 1.962.29Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Rescan
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Scan this page
                </span>
              )}
            </PanelButton>
          </div>
        </div>

        {/* Page title & domain pill bar */}
        {state.pageTitle.length > 0 && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
            <span className="truncate font-semibold text-slate-700">{state.pageTitle}</span>
            {state.domain.length > 0 && (
              <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                {state.domain}
              </span>
            )}
          </div>
        )}

        {state.cards.length > 0 && state.phase !== 'generating' && (
          <div className="mt-1 flex items-center justify-between text-[11px] font-medium text-slate-500">
            <span>
              {state.cards.length} field{state.cards.length === 1 ? '' : 's'} detected
            </span>
            {flaggedCount > 0 ? (
              <span className="font-semibold text-amber-700">⚠️ {flaggedCount} need review</span>
            ) : (
              <span className="font-semibold text-emerald-700">✓ All confident</span>
            )}
          </div>
        )}
      </header>

      {/* Main Content Body */}
      <main className="flex-1 space-y-3 p-3">
        {state.error && (
          <Banner tone="error" title="Could not finish">
            <p>{state.error}</p>
            <div className="pt-1">
              <PanelButton onClick={() => void scan()} disabled={busy}>
                Try again
              </PanelButton>
            </div>
          </Banner>
        )}

        {/* Idle Hero State */}
        {state.phase === 'idle' && (
          <div className="space-y-3">
            <Banner tone="info" title="Nothing scanned yet">
              <p>
                Open a job application page and press{' '}
                <span className="font-semibold text-slate-900">Scan this page</span>. Nothing is
                ever submitted for you — you insert each answer yourself.
              </p>
            </Banner>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200/80 bg-white p-5 text-center shadow-2xs">
              <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-transparent border border-indigo-200/80 shadow-inner">
                <svg
                  className="h-6 w-6 text-indigo-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              </div>

              <h2 className="text-xs font-bold tracking-tight text-slate-900">Ready to Autofill</h2>
              <p className="mt-1 text-[11px] text-slate-500 max-w-[240px] leading-relaxed">
                Click below to scan form fields and draft tailored answers from your profile.
              </p>

              <div className="mt-3.5 w-full">
                <button
                  type="button"
                  onClick={() => void scan()}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 p-2.5 text-xs font-bold text-white shadow-md shadow-indigo-500/25 hover:from-indigo-500 hover:to-violet-500 active:scale-[0.98] transition-all"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Scan Active Tab
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty Page State */}
        {state.phase === 'empty' && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 text-center shadow-2xs">
            <p className="text-sm font-bold text-slate-800">No Form Fields Found</p>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              No input fields or textareas were detected in this page&apos;s main frame. If the form
              is inside an embedded frame, focus it and try again.
            </p>
            <div className="mt-3.5">
              <PanelButton onClick={() => void scan()} disabled={busy}>
                Rescan page
              </PanelButton>
            </div>
          </div>
        )}

        {/* Scanning State */}
        {state.phase === 'scanning' && (
          <div className="rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 p-5 text-center shadow-2xs">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm shadow-indigo-500/30 animate-bounce mb-3">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <p className="text-xs font-bold text-slate-900">Scanning Application Form…</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Detecting inputs, labels, and job description context.
            </p>
          </div>
        )}

        {/* Drafting State */}
        {state.phase === 'generating' && (
          <div className="rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/80 p-5 text-center shadow-2xs">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm shadow-indigo-500/30 animate-pulse mb-3">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
              </svg>
            </div>
            <p className="text-xs font-bold text-slate-900">Drafting Intelligent Answers…</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Matching your profile fragments against {state.cards.length} detected field
              {state.cards.length === 1 ? '' : 's'}.
            </p>
          </div>
        )}

        {/* Field Cards List */}
        {state.cards.length > 0 && (
          <ul className="space-y-3 pb-8">
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

      {/* Footer Status */}
      <footer className="border-t border-slate-200/80 bg-white/90 p-2.5 text-center text-[10.5px] font-medium text-slate-500 backdrop-blur-md">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Drafts only • No auto-submit • Local-only key
        </span>
      </footer>
    </div>
  );
}
