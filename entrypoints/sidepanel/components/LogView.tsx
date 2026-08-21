import { useCallback, useEffect, useState } from 'react';
import { getEntries, clearLog, subscribe } from '@/lib/log';
import type { LogEntry, LogLevel } from '@/lib/log';
import { PanelButton } from './ui';

const LEVEL_TAGS: Record<LogLevel, { text: string; bg: string; border: string }> = {
  error: { text: 'text-red-400', bg: 'bg-red-950/40', border: 'border-red-900/60' },
  warn: { text: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-900/60' },
  info: { text: 'text-sky-400', bg: 'bg-sky-950/40', border: 'border-sky-900/60' },
  debug: { text: 'text-slate-400', bg: 'bg-slate-900', border: 'border-slate-800' },
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleTimeString('en-GB', { hour12: false }) +
    '.' +
    String(d.getMilliseconds()).padStart(3, '0')
  );
}

function EntryRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const tag = LEVEL_TAGS[entry.level];

  return (
    <li
      className={`rounded-xl border ${tag.border} ${tag.bg} p-2.5 font-mono text-[11px] leading-relaxed transition-all`}
    >
      <div className="flex items-start gap-1.5">
        <span className="shrink-0 text-slate-500 text-[10px]">{formatTime(entry.timestamp)}</span>
        <span
          className={`shrink-0 font-bold uppercase text-[9.5px] px-1 rounded ${tag.text} border ${tag.border}`}
        >
          {entry.level}
        </span>
        <span className="shrink-0 rounded bg-slate-800/90 px-1.5 py-0.2 text-[10px] font-semibold text-slate-300">
          {entry.source}
        </span>
        <span className="min-w-0 flex-1 break-words text-slate-200">{entry.message}</span>
      </div>
      {entry.detail && (
        <div className="mt-1.5 pl-1">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 underline"
          >
            {expanded ? '▲ Hide trace' : '▼ View details'}
          </button>
          {expanded && (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950 p-2 text-[10px] text-slate-300 selection:bg-indigo-600">
              {entry.detail}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

export function LogView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<readonly LogEntry[]>(getEntries());
  const [showDebug, setShowDebug] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribe(() => setEntries([...getEntries()]));
  }, []);

  const filtered = showDebug ? entries : entries.filter((e) => e.level !== 'debug');

  const handleClear = useCallback(() => {
    clearLog();
  }, []);

  const handleCopyAll = async () => {
    const text = filtered
      .map(
        (e) =>
          `[${formatTime(e.timestamp)}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}${
            e.detail ? `\n  ${e.detail}` : ''
          }`,
      )
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/90 p-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              aria-label="Back"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path
                  fillRule="evenodd"
                  d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <h1 className="text-xs font-bold tracking-tight text-white">Diagnostics Console</h1>
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                {filtered.length} event{filtered.length === 1 ? '' : 's'} recorded
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10.5px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition-all"
            >
              {copied ? '✓ Copied' : 'Copy log'}
            </button>
            <PanelButton
              onClick={handleClear}
              className="text-slate-300 border-slate-700 bg-slate-800 hover:bg-slate-700"
            >
              Clear
            </PanelButton>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10.5px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-300">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-indigo-600 focus:ring-0"
            />
            Include DEBUG trace
          </label>
        </div>
      </header>

      <main className="flex-1 p-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-500 mb-2">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25ZM2.5 5.25a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75v-9.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-xs font-semibold text-slate-400">Ready & Listening</p>
            <p className="mt-1 text-[11px] text-slate-500 max-w-[220px]">
              Actions taken in the sidepanel will output live diagnostic trace logs here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {[...filtered].reverse().map((entry, i) => (
              <EntryRow key={`${entry.timestamp}-${i}`} entry={entry} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
