import { useCallback, useEffect, useState } from 'react';
import { getEntries, clearLog, subscribe } from '@/lib/log';
import type { LogEntry, LogLevel } from '@/lib/log';

const LEVEL_STYLES: Record<
  LogLevel,
  { label: string; text: string; bg: string; border: string; dot: string }
> = {
  error: {
    label: 'ERR',
    text: 'text-red-400',
    bg: 'bg-red-50',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
  warn: {
    label: 'WRN',
    text: 'text-amber-400',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  info: {
    label: 'INF',
    text: 'text-sky-400',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    dot: 'bg-sky-500',
  },
  debug: {
    label: 'DBG',
    text: 'text-slate-500',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
  },
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
  const s = LEVEL_STYLES[entry.level];

  return (
    <li
      className={`rounded-xl border ${s.border} ${s.bg} px-3 py-2 font-mono text-[10.5px] leading-relaxed transition-all`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
        <span className="shrink-0 text-slate-600 text-[10px] tabular-nums">
          {formatTime(entry.timestamp)}
        </span>
        <span
          className={`shrink-0 font-bold uppercase text-[9px] px-1 py-0.5 rounded border ${s.text} ${s.border}`}
        >
          {s.label}
        </span>
        <span className="shrink-0 rounded bg-slate-800 px-1.5 text-[9.5px] font-semibold text-slate-400">
          {entry.source}
        </span>
        <span className="min-w-0 flex-1 break-words text-slate-700 text-[10.5px]">
          {entry.message}
        </span>
      </div>
      {entry.detail && (
        <div className="mt-1.5 pl-5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 underline"
          >
            {expanded ? '▲ hide' : '▼ details'}
          </button>
          {expanded && (
            <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-[#dbe7f3] bg-[#f8fbff] p-2 text-[10px] text-slate-600 selection:bg-blue-600">
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

  const handleCopyAll = useCallback(async () => {
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
  }, [filtered]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f8fc] text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-[#dbe7f3] bg-white/90 px-3 pt-3 pb-2.5 shadow-[0_8px_24px_rgba(27,78,125,0.06)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-1.5 text-slate-500 transition-all hover:bg-blue-50 hover:text-blue-700"
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
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <h1 className="text-[11.5px] font-bold tracking-tight text-slate-100">
                  Diagnostics Console
                </h1>
              </div>
              <p className="text-[9.5px] text-slate-500 font-mono mt-0.5">
                {filtered.length} event{filtered.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopyAll()}
              className="rounded-xl border border-[#dbe7f3] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition-all"
            >
              {copied ? (
                <span className="flex items-center gap-1 text-emerald-400">
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
                'Copy log'
              )}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-xl border border-[#dbe7f3] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-slate-500 hover:bg-blue-50 hover:text-blue-700 transition-all"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mt-2.5 flex items-center gap-3 border-t border-blue-100 pt-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-[10.5px] text-slate-500 hover:text-slate-300 transition-colors">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="h-3 w-3 rounded border-blue-200 bg-white text-blue-600 focus:ring-0 focus:ring-offset-0"
            />
            Include DEBUG trace
          </label>

          {/* Level legend */}
          <div className="ml-auto flex items-center gap-2">
            {(['error', 'warn', 'info'] as const).map((lvl) => (
              <span
                key={lvl}
                className={`flex items-center gap-1 text-[9px] font-mono font-semibold ${LEVEL_STYLES[lvl].text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLES[lvl].dot}`} />
                {LEVEL_STYLES[lvl].label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 border border-blue-100">
              <svg className="h-5 w-5 text-slate-600" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-9.5A2.25 2.25 0 0 0 16.75 3H3.25ZM2.5 5.25a.75.75 0 0 1 .75-.75h13.5a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75v-9.5Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-[11px] font-semibold text-slate-500">No events yet</p>
            <p className="mt-1 text-[10px] text-slate-600 max-w-[200px] leading-relaxed">
              Actions in the sidepanel will output live diagnostic trace logs here.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {[...filtered].reverse().map((entry, i) => (
              <EntryRow key={`${entry.timestamp}-${i}`} entry={entry} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
