import { useRef, useState } from 'react';
import type { ProfileData } from '@/lib/types';
import { sendMessage } from '@/lib/messaging';
import { MAX_PDF_LABEL } from '@/lib/extractor/types';
import { checkPdfFile, readPdfAsBase64 } from '@/lib/extractor/upload';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  applyReview,
  blockedItems,
  buildReviewItems,
  canAccept,
  discardItem,
  itemsForAutomaticSave,
  setCategoryAccepted,
  setChoiceValue,
  setFieldValue,
  setItemAccepted,
} from '@/lib/extractor/merge';
import type { ReviewItem } from '@/lib/extractor/merge';
import { Button, Section, TextArea, TextInput } from './primitives';

type Stage = 'idle' | 'busy' | 'review';

export function CvImportSection({
  value,
  onApply,
}: {
  value: ProfileData;
  onApply: (next: ProfileData) => Promise<void> | void;
}) {
  const [stage, setStage] = useState<Stage>('idle');
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [automaticSaveFailed, setAutomaticSaveFailed] = useState(false);
  const [automaticallySavedCount, setAutomaticallySavedCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accepted = items.filter((item) => item.accepted);
  const blocked = blockedItems(items);

  const clearReview = () => {
    setItems([]);
    setStage('idle');
    setAutomaticSaveFailed(false);
    setAutomaticallySavedCount(0);
  };

  const handleFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setNotice(null);
    setAutomaticSaveFailed(false);
    setAutomaticallySavedCount(0);

    const problem = checkPdfFile(file);
    if (problem !== undefined) {
      setError(problem);
      return;
    }

    setStage('busy');
    let itemsToReviewOnFailure: ReviewItem[] = [];
    try {
      const pdfBase64 = await readPdfAsBase64(file);
      const extracted = await sendMessage('EXTRACT_CV', { pdfBase64 });
      const built = buildReviewItems(value, extracted);
      if (built.length === 0) {
        setItems([]);
        setStage('idle');
        setNotice('Nothing new — everything in that CV is already in your profile.');
        return;
      }

      const automatic = itemsForAutomaticSave(built);
      const autoSavedIds = new Set(automatic.map((item) => item.id));
      const pending = built
        .filter((item) => !autoSavedIds.has(item.id))
        .map((item) => ({ ...item, accepted: true }));
      itemsToReviewOnFailure = built.map((item) => ({ ...item, accepted: true }));

      if (automatic.length > 0) {
        try {
          await onApply(applyReview(value, automatic));
          setAutomaticallySavedCount(automatic.length);
        } catch (caught) {
          setAutomaticSaveFailed(true);
          throw caught;
        }
      }

      setItems(pending);
      setStage(pending.length > 0 ? 'review' : 'idle');

      if (pending.length > 0) {
        const savedNotice =
          automatic.length > 0
            ? `Saved ${automatic.length} extracted ${automatic.length === 1 ? 'item' : 'items'}. `
            : '';
        setNotice(`${savedNotice}Review the remaining details that need your input.`);
      } else {
        setNotice(
          `Saved ${automatic.length} extracted ${automatic.length === 1 ? 'item' : 'items'} to your profile.`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read that CV.');
      if (itemsToReviewOnFailure.length > 0) {
        setItems(itemsToReviewOnFailure);
        setStage('review');
      } else {
        setStage('idle');
      }
    } finally {
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  };

  const handleConfirm = async () => {
    setApplying(true);
    setError(null);
    const count = accepted.length;
    try {
      await onApply(applyReview(value, items));
      setNotice(`Saved ${count} ${count === 1 ? 'item' : 'items'} to your profile.`);
      setAutomaticSaveFailed(false);
      setAutomaticallySavedCount(0);
      clearReview();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save those items.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Section
      title="Import from a CV"
      badge="PDF Parsing"
      description={`Upload a PDF CV and supported profile details are saved automatically. Project details wait until you tell us whether each project was solo or team work. PDFs up to ${MAX_PDF_LABEL}; the document is sent to the Gemini API and not stored anywhere else.`}
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      }
    >
      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
            : 'border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50/30'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          disabled={stage === 'busy'}
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="absolute inset-0 cursor-pointer opacity-0"
        />

        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl mb-3 transition-all ${dragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}
        >
          {stage === 'busy' ? (
            <svg className="h-5 w-5 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              ></circle>
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </div>

        <p role="status" aria-live="polite" className="text-[12px] font-bold text-slate-800">
          {stage === 'busy'
            ? 'Reading your CV with Gemini; trying other models if needed…'
            : 'Drop your Resume PDF here'}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          or <span className="font-semibold text-indigo-600">browse files</span> · PDF only · Max{' '}
          {MAX_PDF_LABEL}
        </p>
      </div>

      {error !== null && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}
      {notice !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
          {notice}
        </div>
      )}

      {/* Review Stage */}
      {stage === 'review' && (
        <div className="space-y-4 pt-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 leading-relaxed">
            {automaticSaveFailed ? (
              <>
                <span className="font-bold">Automatic save failed:</span> Review the extracted
                values and use the save button below to retry.
              </>
            ) : (
              <>
                <span className="font-bold">Some details need your input:</span>{' '}
                {automaticallySavedCount === 0
                  ? 'Complete required choices or missing information, then save the remaining items.'
                  : 'Other extracted profile fields have already been saved. Complete required choices or missing information, then save the remaining items.'}
              </>
            )}
          </div>

          {CATEGORY_ORDER.map((category) => {
            const inCategory = items.filter((item) => item.category === category);
            if (inCategory.length === 0) return null;
            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <h3 className="text-xs font-bold text-slate-900 tracking-tight">
                    {CATEGORY_LABELS[category]}{' '}
                    <span className="rounded-full bg-slate-100 px-2 py-0.2 text-[10px] text-slate-600 font-normal">
                      {inCategory.length}
                    </span>
                  </h3>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setItems(setCategoryAccepted(items, category, true))}
                      className="rounded-lg px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setItems(setCategoryAccepted(items, category, false))}
                      className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      Select none
                    </button>
                  </div>
                </div>
                {inCategory.map((item) => (
                  <ReviewCard
                    key={item.id}
                    item={item}
                    onToggle={(next) => setItems(setItemAccepted(items, item.id, next))}
                    onEdit={(key, next) => setItems(setFieldValue(items, item.id, key, next))}
                    onChoose={(next) => setItems(setChoiceValue(items, item.id, next))}
                    onDiscard={() => setItems(discardItem(items, item.id))}
                  />
                ))}
              </div>
            );
          })}

          {blocked.length > 0 && (
            <p className="text-xs font-medium text-amber-700">
              {blocked.length === 1
                ? 'One selected item requires'
                : `${blocked.length} selected items require`}{' '}
              required fields to be filled: {blocked.map((item) => item.title).join(', ')}.
            </p>
          )}

          <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={applying || accepted.length === 0 || blocked.length > 0}
            >
              {applying
                ? 'Saving…'
                : `Save ${accepted.length} remaining ${accepted.length === 1 ? 'item' : 'items'}`}
            </Button>
            <Button variant="secondary" onClick={clearReview} disabled={applying}>
              Discard import
            </Button>
            <span className="text-xs font-medium text-slate-500">
              {accepted.length} of {items.length} selected
            </span>
          </div>
        </div>
      )}
    </Section>
  );
}

function ReviewCard({
  item,
  onToggle,
  onEdit,
  onChoose,
  onDiscard,
}: {
  item: ReviewItem;
  onToggle: (accepted: boolean) => void;
  onEdit: (key: string, value: string) => void;
  onChoose: (value: string) => void;
  onDiscard: () => void;
}) {
  const incomplete = item.accepted && !canAccept(item);
  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${
        incomplete
          ? 'border-amber-300 bg-amber-50/50 shadow-2xs'
          : item.accepted
            ? 'border-indigo-200 bg-indigo-50/20 shadow-2xs'
            : 'border-slate-200 bg-slate-50/60 opacity-70'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-slate-100 pb-2.5">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={item.accepted}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 tracking-tight">{item.title}</span>
              {item.status === 'new' ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.2 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  New
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.2 text-[10px] font-semibold text-amber-800 border border-amber-200">
                  Update
                </span>
              )}
            </div>
            {item.existing !== undefined && (
              <span className="mt-0.5 block text-[11px] text-slate-500">
                Current: {item.existing}
              </span>
            )}
          </div>
        </label>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 transition-all"
        >
          Discard
        </button>
      </div>

      <div className="space-y-3">
        {item.fields.map((field) =>
          field.multiline === true ? (
            <TextArea
              key={field.key}
              label={field.label}
              value={field.value}
              onChange={(next) => onEdit(field.key, next)}
            />
          ) : (
            <TextInput
              key={field.key}
              label={field.label}
              value={field.value}
              onChange={(next) => onEdit(field.key, next)}
            />
          ),
        )}

        {item.category === 'projects' && (
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">
              {item.choice.label}
            </span>
            <div className="flex items-center gap-4">
              {item.choice.options.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  <input
                    type="radio"
                    name={`choice-${item.id}`}
                    value={option.value}
                    checked={item.choice.value === option.value}
                    onChange={() => onChoose(option.value)}
                    className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{item.choice.hint}</p>
          </div>
        )}
      </div>
    </div>
  );
}
