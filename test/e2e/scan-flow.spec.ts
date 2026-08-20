import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import {
  BUILD_FIRST,
  MANIFEST_PATH,
  backgroundWorker,
  extensionBuilt,
  extensionId,
  launchWithExtension,
} from './extension';
import { describePageMessageFailure } from '../../entrypoints/sidepanel/state';
import type { ScanResult } from '../../lib/messaging';

// Phase 12: the review panel, end to end in a real browser with the real
// extension loaded — the shipped content script answering a real TRIGGER_SCAN,
// and the shipped side panel document rendering what comes back.
//
// The one part of the phase's acceptance this cannot cover is the mock-generator
// run: the flag is compiled in (VITE_USE_MOCK_GENERATOR, see lib/generator), so
// a build without it has no API key here and generation fails by design. That
// failure path is asserted instead — the drafts themselves are covered by
// test/unit/panel-state.test.ts, and the visual check by the manual run
// documented in the README.

const PORT = Number(process.env.FIXTURE_PORT ?? 3999);
const fixtureUrl = (path: string) => `http://localhost:${PORT}${path}`;

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
}

type ScanAttempt =
  | { ok: true; result: ScanResult }
  /** `lastError` is what Chrome itself reported, for diagnosis. */
  | { ok: false; message: string; lastError: string };

/**
 * Ask the active tab's main frame to scan, exactly as the side panel does.
 *
 * Sent from the service worker because that is a context inside the extension:
 * the wire shape is @webext-core/messaging's, and the callback transport is the
 * one lib/messaging.ts uses — which is why a frame with no listener produces an
 * undefined response rather than a rejection.
 */
async function triggerScan(context: BrowserContext): Promise<ScanAttempt> {
  const worker = await backgroundWorker(context);
  return (await worker.evaluate(async () => {
    const api = (globalThis as unknown as { chrome: ChromeSlice }).chrome;
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) {
      return { ok: false, message: 'No active tab to scan.', lastError: '' };
    }

    const { response, lastError } = await new Promise<{
      response: { res?: unknown; err?: { message?: string } } | undefined;
      lastError: string;
    }>((resolve) => {
      api.tabs.sendMessage(
        tab.id!,
        { id: 1, type: 'TRIGGER_SCAN', data: undefined, timestamp: 1 },
        { frameId: 0 },
        (raw) => {
          // Only valid inside the callback, so it is read here rather than after.
          resolve({
            response: raw as { res?: unknown; err?: { message?: string } } | undefined,
            lastError: api.runtime.lastError?.message ?? '',
          });
        },
      );
    });

    if (response?.res !== undefined) return { ok: true, result: response.res };
    return { ok: false, message: response?.err?.message ?? 'No response', lastError };
  })) as ScanAttempt;
}

/**
 * Scan, retrying briefly.
 *
 * The content script registers its listener at document_idle, which can land a
 * moment after `goto` resolves; retrying is the difference between a real
 * failure and a race.
 */
async function scanWithRetry(context: BrowserContext): Promise<ScanResult> {
  let last: ScanAttempt = { ok: false, message: 'never attempted', lastError: '' };
  for (let attempt = 0; attempt < 10; attempt++) {
    last = await triggerScan(context);
    if (last.ok) return last.result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`TRIGGER_SCAN failed: ${last.ok ? '' : `${last.message} (${last.lastError})`}`);
}

test.describe('the loaded extension', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);

  let context: BrowserContext;
  /** The tab under test. Kept as the active tab, since that is what a scan reads. */
  let page: Page;

  test.beforeAll(async () => {
    context = await launchWithExtension();
    page = context.pages()[0] ?? (await context.newPage());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('scans standard-labels.html through the real content script', async () => {
    await page.goto(fixtureUrl('/standard-labels.html'));
    const result = await scanWithRetry(context);

    const byLabel = new Map(result.fields.map((f) => [f.resolvedLabel, f]));
    expect([...byLabel.keys()].sort()).toEqual(
      ['Country', 'Cover Letter', 'Email Address', 'Full Name'].sort(),
    );
    expect(byLabel.get('Cover Letter')?.elementType).toBe('textarea');
    expect(byLabel.get('Full Name')?.labelConfidence).toBe('structured');

    // The job context travels with the scan, so the panel has a domain to key
    // corrections on and the prompt has the page's text.
    expect(result.context.pageTitle).toBe('Standard Labels Fixture');
    expect(result.context.url).toBe(fixtureUrl('/standard-labels.html'));
    expect(result.context.rawText).toContain('Application form');
  });

  test('scans shadow-dom.html, reaching into the open shadow root', async () => {
    await page.goto(fixtureUrl('/shadow-dom.html'));
    const result = await scanWithRetry(context);

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]!.resolvedLabel).toBe('Shadow Field');
    expect(result.fields[0]!.elementType).toBe('input:text');
  });

  test('reports a page with no content script in words the user can act on', async () => {
    // about:blank matches no content script, standing in for the browser pages,
    // Web Store, and PDF views where a scan genuinely cannot work.
    await page.goto('about:blank');
    const attempt = await triggerScan(context);

    expect(attempt.ok).toBe(false);
    if (attempt.ok) return;
    // What the panel actually receives: the transport resolves undefined, and
    // the messaging library turns that into "No response". The unit tests for
    // describePageMessageFailure are written against this exact string.
    expect(attempt.message).toBe('No response');
    expect(attempt.lastError).toMatch(
      /receiving end does not exist|could not establish connection/i,
    );
    expect(describePageMessageFailure(new Error(attempt.message))).toMatch(/Reload the tab/);
  });

  test('the side panel renders a scan, flags every unanswered field, and stays editable', async () => {
    await page.goto(fixtureUrl('/standard-labels.html'));
    const panel = await context.newPage();
    try {
      await panel.goto(`chrome-extension://${await extensionId(context)}/sidepanel.html`);

      // Nothing is scanned, and nothing is spent, until the user asks.
      await expect(panel.getByText('Nothing scanned yet')).toBeVisible();

      // The panel scans the active tab, so the fixture has to be the one in front.
      await page.bringToFront();
      await panel.getByRole('button', { name: 'Scan this page' }).click();

      for (const label of ['Full Name', 'Email Address', 'Cover Letter', 'Country']) {
        await expect(panel.getByRole('heading', { name: label })).toBeVisible();
      }
      await expect(panel.getByText('4 fields detected')).toBeVisible();

      // No API key is configured in this profile, so generation fails — and the
      // panel says why while keeping the fields it detected.
      await expect(panel.getByText('Could not finish')).toBeVisible();
      await expect(panel.getByText(/API key/i)).toBeVisible();

      // Every card came back without a draft, so every card is flagged rather
      // than presented as if it were ready to send.
      await expect(panel.getByText('Needs review')).toHaveCount(4);
      await expect(panel.getByText('No draft came back for this field.')).toHaveCount(4);

      const coverLetter = panel
        .locator('li', { has: panel.getByRole('heading', { name: 'Cover Letter' }) })
        .first();
      const draft = coverLetter.locator('textarea');
      await expect(draft).toHaveValue('');
      // Insert is unavailable until there is something to insert.
      await expect(coverLetter.getByRole('button', { name: 'Insert' })).toBeDisabled();

      await draft.fill('I ship offline-first mobile apps.');
      await expect(draft).toHaveValue('I ship offline-first mobile apps.');
      await expect(coverLetter.getByRole('button', { name: 'Insert' })).toBeEnabled();
    } finally {
      await panel.close();
    }
  });

  test('the built manifest opens the panel from the toolbar button', async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

    // Chrome needs all three: the panel document, permission to open it, and an
    // action to bind the open-on-click behaviour to (see entrypoints/background.ts).
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.action).toBeTruthy();
  });
});
