import { chromium } from '@playwright/test';
import type { BrowserContext, Worker } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
