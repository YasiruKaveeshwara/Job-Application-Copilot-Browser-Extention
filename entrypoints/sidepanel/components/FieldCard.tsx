import { useEffect, useState } from 'react';
import type { FieldCard } from '../state';
import { canSaveCorrection, correctionBlockedReason, reviewReasons } from '../state';
import { Badge, Banner, PanelButton } from './ui';

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500';

/** Long-form fields get room to read; a one-line field doesn't need six rows. */
function rowsFor(elementType: string): number {
  return elementType === 'textarea' || elementType === 'contenteditable' ? 7 : 2;
}

function InsertStatus({ card }: { card: FieldCard }) {
  if (card.insert.phase === 'inserted') {
    return <span className="text-[11px] text-emerald-700">Written into the page.</span>;
  }
  if (card.insert.phase === 'failed') {
    return (
      <span className="text-[11px] text-red-700">
        {card.insert.error ?? 'The field could not be updated.'}
      </span>
    );
  }
  return null;
}

/**
 * The manual correction control.
 *
 * Corrects what the field is asking for, keyed by the label the detector
 * resolved, and saved per site — the shape `SAVE_FIELD_MAPPING` persists. Shown
 * only on cards that already need review, so it reads as a fix for something
 * visibly wrong rather than a form to fill in.
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

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <label className="block">
        <span className="text-[11px] font-medium text-gray-600">
          Wrong question? Say what this field actually asks for
        </span>
        <input
          value={card.correction.value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. work-authorization"
          disabled={blocked !== null}
          className={`mt-1 ${TEXTAREA_CLASSES} disabled:bg-gray-50 disabled:text-gray-400`}
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <PanelButton
          onClick={onSave}
          disabled={!canSaveCorrection(card, domain) || card.correction.phase === 'saving'}
        >
          {card.correction.phase === 'saving' ? 'Saving…' : 'Remember for this site'}
        </PanelButton>
        {card.correction.phase === 'saved' && (
          <span className="text-[11px] text-emerald-700">
            Saved for {domain}. It will hint the next scan.
          </span>
        )}
        {card.correction.phase === 'failed' && (
          <span className="text-[11px] text-red-700">
            {card.correction.error ?? 'Could not save the correction.'}
          </span>
        )}
      </div>
      {blocked && <p className="mt-1 text-[11px] text-gray-500">{blocked}</p>}
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
  // A "Copied" note next to text that has since changed is a small lie.
  useEffect(() => setCopyState('idle'), [card.draft]);

  const reasons = pending ? [] : reviewReasons(card);
  const flagged = reasons.length > 0;

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
      className={`rounded-lg border bg-white p-3 shadow-sm ${
        flagged ? 'border-amber-300' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          {card.label.trim().length > 0 ? (
            card.label
          ) : (
            <span className="text-gray-500 italic">(no label found)</span>
          )}
        </h2>
        {flagged && <Badge tone="warn">Needs review</Badge>}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Badge>{card.elementType}</Badge>
        {card.classifiedType.length > 0 && <Badge>{card.classifiedType}</Badge>}
        {card.confidence === 'high' && <Badge tone="ok">high confidence</Badge>}
      </div>

      {flagged && (
        <div className="mt-2">
          <Banner tone="warn" title="Check this one yourself">
            <ul className="list-disc space-y-0.5 pl-4">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      <textarea
        rows={rowsFor(card.elementType)}
        value={card.draft}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={pending ? 'Drafting…' : 'No draft — write your own answer here.'}
        className={`mt-2 ${TEXTAREA_CLASSES}`}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PanelButton onClick={() => void copy()} disabled={card.draft.length === 0}>
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </PanelButton>
        <PanelButton
          variant="primary"
          onClick={onInsert}
          disabled={card.draft.length === 0 || card.insert.phase === 'inserting'}
        >
          {card.insert.phase === 'inserting' ? 'Inserting…' : 'Insert'}
        </PanelButton>
        {copyState === 'failed' && (
          <span className="text-[11px] text-red-700">
            Could not reach the clipboard — select the text and copy it manually.
          </span>
        )}
        <InsertStatus card={card} />
      </div>

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
