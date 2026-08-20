import { useEffect, useState } from 'react';
import { CACHE_TTL_MS, clearAnswerCache, countCachedAnswers } from '@/lib/cache';
import { Button, Section } from './primitives';

// The one control the answer cache needs. Everything else about it is automatic:
// an entry stops being used the moment the profile, the correction, or the model
// behind it changes (see lib/cache.ts), so this exists for the case a key cannot
// see — the user simply wants different words this time.

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
        // A count is decoration; not being able to read it must not break the page.
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
    >
      <div className="flex items-center gap-3">
        <Button onClick={handleClear} disabled={clearing || count === 0}>
          {clearing ? 'Clearing…' : 'Clear cached drafts'}
        </Button>
        <span className="text-sm text-gray-500">
          {count === null ? 'Count unavailable' : `${count} cached`}
        </span>
        {failed && <span className="text-sm text-red-600">Could not clear them</span>}
      </div>
    </Section>
  );
}
