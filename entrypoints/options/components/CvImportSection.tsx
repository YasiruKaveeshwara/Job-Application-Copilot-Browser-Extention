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
  setCategoryAccepted,
  setChoiceValue,
  setFieldValue,
  setItemAccepted,
} from '@/lib/extractor/merge';
import type { ReviewItem } from '@/lib/extractor/merge';
import { Button, Section, TextArea, TextInput } from './primitives';

// The CV import screen: pick a PDF, see everything the model read off it grouped
// by category, edit or drop any of it, and only then save.
//
// The rule this UI exists to keep is that nothing is written until the user
// presses Confirm. It holds because the review list lives in local state and the
// only way out of it is `applyReview` (lib/extractor/merge.ts) followed by the
// page's own save — there is no other write path, and the notice below says so
// where the user can see it the whole time.
//
// Imports point at lib/extractor/{types,merge,upload} rather than at
// lib/extractor: the index also exports the Gemini extractor, and pulling that
// into the options bundle would put the API endpoint in options.js. The packaging
// spec asserts it appears in background.js alone.

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
  const [applying, setApplying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accepted = items.filter((item) => item.accepted);
  const blocked = blockedItems(items);

  const clearReview = () => {
    setItems([]);
    setStage('idle');
  };

  const handleFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setNotice(null);

    const problem = checkPdfFile(file);
    if (problem !== undefined) {
      setError(problem);
      return;
    }

    setStage('busy');
    try {
      const pdfBase64 = await readPdfAsBase64(file);
      const extracted = await sendMessage('EXTRACT_CV', { pdfBase64 });
      // Built against the profile as it stands right now, including edits made on
      // this page but not yet saved — so "already have this" means what the user
      // sees above, not what storage happened to hold when the page loaded.
      const built = buildReviewItems(value, extracted);
      setItems(built);
      setStage(built.length > 0 ? 'review' : 'idle');
      if (built.length === 0) {
        setNotice('Nothing new — everything that CV states is already in your profile.');
      }
    } catch (caught) {
      // The background words its own failures (lib/orchestrator.ts); anything
      // else is a read that never got as far as a request.
      setError(caught instanceof Error ? caught.message : 'Could not read that CV.');
      setStage('idle');
    } finally {
      // So picking the same file again fires a change event.
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
      description={`Upload a PDF CV and the model reads what it can off it. Nothing is written to your profile until you confirm it below. PDFs up to ${MAX_PDF_LABEL}; the document is sent to the Gemini API and not stored anywhere else.`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          disabled={stage === 'busy'}
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="block text-sm text-gray-700 file:mr-3 file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-50"
        />
        {stage === 'busy' && <span className="text-sm text-gray-500">Reading the CV…</span>}
      </div>

      {error !== null && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      {stage === 'review' && (
        <div className="space-y-4">
          {/* Stays on screen for the whole review, not a toast: it is the promise
              the feature makes, and the user is about to tick boxes on the
              strength of it. */}
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Nothing is saved until you press <span className="font-medium">Confirm</span>.
            Everything below is a proposal — edit it, untick it, or discard it.
          </p>

          {CATEGORY_ORDER.map((category) => {
            const inCategory = items.filter((item) => item.category === category);
            if (inCategory.length === 0) return null;
            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {CATEGORY_LABELS[category]}{' '}
                    <span className="font-normal text-gray-500">({inCategory.length})</span>
                  </h3>
                  <div className="flex gap-2">
                    <Button onClick={() => setItems(setCategoryAccepted(items, category, true))}>
                      Select all
                    </Button>
                    <Button onClick={() => setItems(setCategoryAccepted(items, category, false))}>
                      Select none
                    </Button>
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
            <p className="text-sm text-amber-700">
              {blocked.length === 1
                ? 'One ticked item still needs'
                : `${blocked.length} ticked items still need`}{' '}
              something filled in or answered: {blocked.map((item) => item.title).join(', ')}.
            </p>
          )}

          <div className="flex items-center gap-3 border-t border-gray-200 pt-4">
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={applying || accepted.length === 0 || blocked.length > 0}
            >
              {applying
                ? 'Saving…'
                : `Confirm and save ${accepted.length} ${accepted.length === 1 ? 'item' : 'items'}`}
            </Button>
            <Button onClick={clearReview} disabled={applying}>
              Discard this import
            </Button>
            <span className="text-sm text-gray-500">
              {accepted.length} of {items.length} ticked
            </span>
          </div>
        </div>
      )}
    </Section>
  );
}

/** One extracted thing, with everything the user can do to it before it is saved. */
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
      className={
        incomplete
          ? 'rounded-md border border-amber-300 bg-amber-50 p-4'
          : 'rounded-md border border-gray-200 bg-gray-50 p-4'
      }
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={item.accepted}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="text-sm font-medium text-gray-800">{item.title}</span>{' '}
            {item.status === 'new' ? (
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                New
              </span>
            ) : (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                Proposed change
              </span>
            )}
            {item.existing !== undefined && (
              <span className="mt-1 block text-xs text-gray-500">
                Already saved: {item.existing}
              </span>
            )}
          </span>
        </label>
        <Button variant="danger" onClick={onDiscard}>
          Discard
        </Button>
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
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {item.choice.label}
            </span>
            <div className="flex items-center gap-4">
              {item.choice.options.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name={`choice-${item.id}`}
                    value={option.value}
                    checked={item.choice.value === option.value}
                    onChange={() => onChoose(option.value)}
                    className="h-4 w-4 border-gray-300"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">{item.choice.hint}</p>
          </div>
        )}
      </div>
    </div>
  );
}
