import { useEffect, useState } from 'react';
import type { FieldCard } from '../state';
import { canSaveCorrection, correctionBlockedReason, reviewReasons } from '../state';
import { Badge, Banner, PanelButton } from './ui';

const TEXTAREA_CLASSES =
  'w-full rounded-xl border border-slate-200 bg-slate-50/50 p-2.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 leading-relaxed';

/** Long-form fields get room to read; a one-line field doesn't need six rows. */
function rowsFor(elementType: string): number {
  return elementType === 'textarea' || elementType === 'contenteditable' ? 6 : 2;
}

function InsertStatus({ card }: { card: FieldCard }) {
  if (card.insert.phase === 'inserted') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
        Inserted
      </span>
    );
  }
  if (card.insert.phase === 'failed') {
    return (
      <span className="text-[11px] font-medium text-red-600">
        {card.insert.error ?? 'Could not insert.'}
      </span>
    );
  }
  return null;
}

/**
 * The manual correction control.
 * Corrects what the field is asking for, keyed by the label the detector
 * resolved, and saved per site.
 */
function CorrectionForm({
  card,
  domain,
  onChange,
  onSave,
}: {
  card: FieldCard;
  domain: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const blocked = correctionBlockedReason(card, domain);
  const presets = [
    'work-authorization',
    'sponsorship-required',
    'notice-period',
    'years-experience',
    'salary-expectation',
  ];

  return (
    <div className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-3 transition-all">
      <label className="block">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
          <svg className="h-3.5 w-3.5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
            <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
            <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
          </svg>
          Wrong question? Say what this field actually asks for:
        </span>
        <input
          value={card.correction.value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. work-authorization"
          disabled={blocked !== null}
          className="mt-1.5 w-full rounded-lg border border-amber-300/80 bg-white px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
        />
      </label>

      {/* Quick preset chips */}
      <div className="mt-2 flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className="rounded-md bg-white/90 border border-amber-200/90 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 transition-all shadow-2xs"
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <PanelButton
          onClick={onSave}
          disabled={!canSaveCorrection(card, domain) || card.correction.phase === 'saving'}
        >
          {card.correction.phase === 'saving' ? 'Saving…' : 'Remember for this site'}
        </PanelButton>
        {card.correction.phase === 'saved' && (
          <span className="text-[11px] font-semibold text-emerald-700">
            ✓ Saved for {domain}. It will hint the next scan.
          </span>
        )}
        {card.correction.phase === 'failed' && (
          <span className="text-[11px] font-medium text-red-600">
            {card.correction.error ?? 'Could not save the correction.'}
          </span>
        )}
      </div>
      {blocked && <p className="mt-1 text-[10.5px] text-amber-800/90">{blocked}</p>}
    </div>
  );
}

export function FieldCardView({
  card,
  domain,
  pending,
  onDraftChange,
  onInsert,
  onCorrectionChange,
  onSaveCorrection,
}: {
  card: FieldCard;
  domain: string;
  /** True while drafts are still being generated: don't flag what hasn't arrived. */
  pending: boolean;
  onDraftChange: (draft: string) => void;
  onInsert: () => void;
  onCorrectionChange: (value: string) => void;
  onSaveCorrection: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => setCopyState('idle'), [card.draft]);

  const reasons = pending ? [] : reviewReasons(card);
  const flagged = reasons.length > 0;
  const isInserted = card.insert.phase === 'inserted';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.draft);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <li
      className={`group relative rounded-2xl border bg-white p-3.5 shadow-2xs transition-all duration-200 hover:shadow-md ${
        isInserted
          ? 'border-emerald-200/90 bg-emerald-50/20'
          : flagged
            ? 'border-amber-300/90 bg-amber-50/20'
            : 'border-slate-200/90 hover:border-indigo-200'
      }`}
    >
      {/* Top Header: Label & Status Badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-bold tracking-tight text-slate-900 break-words leading-snug">
            {card.label.trim().length > 0 ? (
              card.label
            ) : (
              <span className="text-slate-400 italic font-normal">(no label found)</span>
            )}
          </h2>
        </div>
        {flagged && (
          <Badge tone="warn" dot>
            Needs review
          </Badge>
        )}
      </div>

      {/* Tags: Element type, classified intent, confidence */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone="neutral">{card.elementType}</Badge>
        {card.classifiedType.length > 0 && <Badge tone="indigo">{card.classifiedType}</Badge>}
        {card.confidence === 'high' && (
          <Badge tone="ok" dot>
            High match
          </Badge>
        )}
      </div>

      {/* Warning reasons if flagged */}
      {flagged && (
        <div className="mt-2.5">
          <Banner tone="warn" title="Check before inserting">
            <ul className="list-disc space-y-0.5 pl-3.5 text-[11px]">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {/* Editable Draft Text Area */}
      <div className="relative mt-2.5">
        <textarea
          rows={rowsFor(card.elementType)}
          value={card.draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={
            pending
              ? '✨ Drafting intelligent response…'
              : 'No draft generated — write your answer here.'
          }
          className={TEXTAREA_CLASSES}
        />
        {card.draft.length > 0 && (
          <span className="absolute bottom-2 right-2.5 text-[10px] font-mono text-slate-400 pointer-events-none bg-white/80 px-1 rounded">
            {card.draft.length} chars
          </span>
        )}
      </div>

      {/* Action Toolbar */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <PanelButton onClick={() => void copy()} disabled={card.draft.length === 0}>
            {copyState === 'copied' ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                    clipRule="evenodd"
                  />
                </svg>
                Copied
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V16.5A1.5 1.5 0 0 1 15.5 18h-7A1.5 1.5 0 0 1 7 16.5v-13Z" />
                  <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v11A1.5 1.5 0 0 0 4.5 20h7a1.5 1.5 0 0 0 1.5-1.5v-1h-1.5a2 2 0 0 1-2-2V7.5A1.5 1.5 0 0 0 8 6H4.5Z" />
                </svg>
                Copy
              </span>
            )}
          </PanelButton>

          <PanelButton
            variant="primary"
            onClick={onInsert}
            disabled={card.draft.length === 0 || card.insert.phase === 'inserting'}
          >
            {card.insert.phase === 'inserting' ? (
              <span className="flex items-center gap-1">
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
                Inserting…
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.59L7.3 9.24a.75.75 0 0 0-1.1 1.02l3.25 3.5a.75.75 0 0 0 1.1 0l3.25-3.5a.75.75 0 1 0-1.1-1.02l-1.95 2.1V6.75Z"
                    clipRule="evenodd"
                  />
                </svg>
                Insert
              </span>
            )}
          </PanelButton>
        </div>

        <InsertStatus card={card} />
      </div>

      {copyState === 'failed' && (
        <p className="mt-1.5 text-[10px] text-red-600">
          Clipboard access denied — please select and copy manually.
        </p>
      )}

      {/* Manual learned correction toggle */}
      {flagged && (
        <CorrectionForm
          card={card}
          domain={domain}
          onChange={onCorrectionChange}
          onSave={onSaveCorrection}
        />
      )}
    </li>
  );
}
