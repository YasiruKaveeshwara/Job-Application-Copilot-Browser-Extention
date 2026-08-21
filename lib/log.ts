/**
 * In-memory diagnostic log for the side panel.
 *
 * Captures extension lifecycle events, message send/receive results, and errors
 * so the user can see exactly what happened when something doesn't work. Entries
 * are kept in memory only and capped to a fixed size; nothing is persisted.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 200;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function log(level: LogLevel, source: string, message: string, detail?: unknown): void {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    source,
    message,
    detail: detail !== undefined ? formatDetail(detail) : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  notify();

  // Also mirror to the browser console so devtools picks it up.
  const tag = `[${source}]`;
  if (level === 'error') console.error(tag, message, detail ?? '');
  else if (level === 'warn') console.warn(tag, message, detail ?? '');
  else if (level === 'debug') console.debug(tag, message, detail ?? '');
  else console.log(tag, message, detail ?? '');
}

export function getEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLog(): void {
  entries.length = 0;
  notify();
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function formatDetail(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.cause ? `\n  cause: ${formatDetail(value.cause)}` : ''}`;
  }
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
