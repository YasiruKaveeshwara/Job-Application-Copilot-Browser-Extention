import { chromium } from '@playwright/test';
import type { BrowserContext, Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { InsertFieldResult, ProtocolMap, ScanResult } from '../../lib/messaging';

// Launching the real extension: the unpacked MV3 build, loaded into a persistent
// profile (build guide, section 1). Specs that use this drive the shipped code —
// the actual content script, the actual service worker, the actual side panel
// document — rather than a transpiled copy of one module.

/** The unpacked Chrome build, produced by `npm run build`. */
export const EXTENSION_DIR = fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url));

export const MANIFEST_PATH = fileURLToPath(
  new URL('../../.output/chrome-mv3/manifest.json', import.meta.url),
);

export const BUILD_FIRST = 'run `npm run build` first to generate .output/chrome-mv3';

export function extensionBuilt(): boolean {
  return existsSync(MANIFEST_PATH);
}

/**
 * Launch Chromium with the extension loaded.
 *
 * Two requirements that are easy to get wrong: extensions need a persistent
 * profile (an empty `userDataDir` gives a throwaway one), and they need the full
 * Chromium build — the headless shell Playwright installs by default does not
 * run extensions at all, which is what `channel: 'chromium'` selects around.
 */
export function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
}

/**
 * The MV3 background service worker.
 *
 * It is spawned on demand, so it may not exist yet when the context is ready;
 * wait for the event in that case.
 */
export async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

/**
 * The extension's runtime id, read off the service worker's own URL.
 *
 * Needed to open extension documents (`sidepanel.html`, `options.html`) as
 * ordinary tabs, which is the only way to drive them from Playwright.
 */
export async function extensionId(context: BrowserContext): Promise<string> {
  const worker = await backgroundWorker(context);
  const id = new URL(worker.url()).host;
  if (id.length === 0) throw new Error(`could not read an extension id from ${worker.url()}`);
  return id;
}

/** The slice of the extension API the injected snippets use. */
interface ChromeSlice {
  runtime: { lastError?: { message?: string } };
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<{ id?: number }[]>;
    sendMessage(
      tabId: number,
      message: unknown,
      options: { frameId: number },
      callback: (response: unknown) => void,
    ): void;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number; allFrames: boolean };
      func: () => string;
    }): Promise<{ frameId: number; result?: string }[]>;
  };
}

export type PageMessageAttempt<T> =
  | { ok: true; result: T }
  /** `lastError` is what Chrome itself reported, kept for diagnosis. */
  | { ok: false; message: string; lastError: string };

/**
 * Send one of the extension's own messages to a frame of the active tab.
 *
 * Sent from the service worker, because that is a context inside the extension:
 * the wire shape is @webext-core/messaging's and the transport is the same
 * callback one lib/messaging.ts uses, so a spec sees exactly what the side panel
 * would see — including that a frame with no listener yields an undefined
 * response rather than a rejection.
 *
 * `frameId` defaults to 0, the top frame, which is the only one the shipped
 * panel addresses. Passing another id is how a spec reaches into an iframe (see
 * cross-origin.spec.ts).
 */
export async function sendToActiveTab<T>(
  context: BrowserContext,
  type: keyof ProtocolMap,
  data?: unknown,
  frameId = 0,
): Promise<PageMessageAttempt<T>> {
  const worker = await backgroundWorker(context);
  return (await worker.evaluate(
    async ({ type, data, frameId }) => {
      const api = (globalThis as unknown as { chrome: ChromeSlice }).chrome;
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) {
        return { ok: false, message: 'No active tab to scan.', lastError: '' };
      }

      const { response, lastError } = await new Promise<{
        response: { res?: unknown; err?: { message?: string } } | undefined;
        lastError: string;
      }>((resolve) => {
        api.tabs.sendMessage(tab.id!, { id: 1, type, data, timestamp: 1 }, { frameId }, (raw) => {
          // lastError is only valid inside the callback, so it is read here.
          resolve({
            response: raw as { res?: unknown; err?: { message?: string } } | undefined,
            lastError: api.runtime.lastError?.message ?? '',
          });
        });
      });

      if (response?.res !== undefined) return { ok: true, result: response.res };
      return { ok: false, message: response?.err?.message ?? 'No response', lastError };
    },
    { type, data, frameId },
  )) as PageMessageAttempt<T>;
}

/**
 * Scan a frame of the active tab, retrying briefly.
 *
 * The content script registers its listener at document_idle, which can land a
 * moment after `goto` resolves; retrying is the difference between a real
 * failure and a race.
 */
export async function scanActiveTab(context: BrowserContext, frameId = 0): Promise<ScanResult> {
  let last: PageMessageAttempt<ScanResult> = {
    ok: false,
    message: 'never attempted',
    lastError: '',
  };
  for (let attempt = 0; attempt < 10; attempt++) {
    last = await sendToActiveTab<ScanResult>(context, 'TRIGGER_SCAN', undefined, frameId);
    if (last.ok) return last.result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TRIGGER_SCAN failed: ${last.ok ? '' : `${last.message} (${last.lastError})`}`);
}

/** One frame the extension was able to inject into, with the URL it reported. */
export interface FrameProbe {
  frameId: number;
  url: string;
}

export type FrameProbeResult = { ok: true; frames: FrameProbe[] } | { ok: false; error: string };

/**
 * Every frame of the active tab the extension can actually reach.
 *
 * `chrome.scripting.executeScript` with `allFrames` is the way to enumerate
 * frames on the permissions this extension asks for — `webNavigation`, which
 * would give `getAllFrames` directly, is deliberately not in the manifest. The
 * result is therefore not "the frames that exist" (Playwright's `page.frames()`
 * is the authority on that) but "the frames host_permissions covers", which is
 * exactly what Phase 16 is about.
 */
export async function reachableFrames(context: BrowserContext): Promise<FrameProbeResult> {
  const worker = await backgroundWorker(context);
  return (await worker.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: ChromeSlice }).chrome;
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return { ok: false, error: 'No active tab.' };
    try {
      const injected = await api.scripting.executeScript({
        target: { tabId: tab.id!, allFrames: true },
        func: () => location.href,
      });
      return {
        ok: true,
        frames: injected.map((frame) => ({ frameId: frame.frameId, url: frame.result ?? '' })),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })) as FrameProbeResult;
}

/** Insert one answer into a frame of the active tab, as the panel's Insert button does. */
export async function insertIntoActiveTab(
  context: BrowserContext,
  domRef: string,
  finalText: string,
  frameId = 0,
): Promise<InsertFieldResult> {
  const attempt = await sendToActiveTab<InsertFieldResult>(
    context,
    'INSERT_FIELD',
    { domRef, finalText },
    frameId,
  );
  if (!attempt.ok) {
    throw new Error(
      `INSERT_FIELD never reached the page: ${attempt.message} (${attempt.lastError})`,
    );
  }
  return attempt.result;
}

/**
 * Everything the extension has written to `chrome.storage.local`.
 *
 * Returned whole rather than by key: WXT owns the key naming behind
 * `storage.defineItem`, and a spec that asserts on the real stored record is
 * checking what the extension actually persisted.
 */
export async function readLocalStorage(context: BrowserContext): Promise<Record<string, unknown>> {
  const worker = await backgroundWorker(context);
  return (await worker.evaluate(() => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(keys: null): Promise<Record<string, unknown>> } } };
      }
    ).chrome;
    return api.storage.local.get(null);
  })) as Record<string, unknown>;
}
