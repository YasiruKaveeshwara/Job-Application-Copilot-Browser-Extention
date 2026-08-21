import { useEffect, useState } from 'react';
import { CACHE_TTL_MS, clearAnswerCache, countCachedAnswers } from '@/lib/cache';
import { Button, Section } from './primitives';

const TTL_DAYS = Math.round(CACHE_TTL_MS / (24 * 60 * 60 * 1000));

export function CachedDraftsSection() {
  const [count, setCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    countCachedAnswers()
      .then((total) => {
        if (active) setCount(total);
      })
      .catch(() => {
        if (active) setCount(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleClear = async () => {
    setClearing(true);
    setFailed(false);
    try {
      await clearAnswerCache();
      setCount(0);
    } catch {
      setFailed(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <Section
      title="Cached drafts"
      description={`Answers already drafted are reused when the same question comes up for the same kind of role, until the profile behind them changes or ${TTL_DAYS} days pass. Clearing them costs nothing but a re-draft.`}
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">
            {count === null ? 'Count unavailable' : `${count} cached`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleClear} disabled={clearing || count === 0}>
            {clearing ? 'Clearing…' : 'Clear cached drafts'}
          </Button>
          {failed && <span className="text-xs font-medium text-red-600">Could not clear them</span>}
        </div>
      </div>
    </Section>
  );
}
