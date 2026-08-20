import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  BUILD_FIRST,
  extensionBuilt,
  extensionId,
  launchWithExtension,
  reachableFrames,
  scanActiveTab,
  sendToActiveTab,
} from './extension';
import type { ScanResult } from '../../lib/messaging';

// Phase 16: what happens when the application form is served from a different
// origin than the page the user is looking at — the normal shape of a careers
// page that embeds an ATS.
//
// The fixture is the real thing rather than a same-origin stand-in:
// cross-origin-parent.html is served from localhost and points its iframe at
// 127.0.0.1 on the same fixture server. Same bytes, genuinely different origin,
// so the browser applies real cross-origin rules to it.
//
// Three questions, and they have three different answers:
//
//   1. Can the extension read fields inside that frame? Yes — the content script
//      is registered for <all_urls> with all_frames, so it runs in the child
//      document and answers a scan for it.
//
//   2. Does the shipped side panel show them? No. The panel addresses frame 0
//      only (entrypoints/sidepanel/App.tsx), so a cross-origin form's fields
//      never reach the review list. That is a product limitation, not a
//      permissions one, and the second test pins it so it cannot change silently.
//
//   3. What breaks when the manifest does not cover the child origin? Nothing
//      breaks; that frame is simply never scanned. Which part of the manifest is
//      narrowed decides how much is lost, and the two are separable — the last
//      two tests are one per narrowing.
//
// Those last two need a differently-configured build, so each skips unless that
// build is loaded. The README's "Cross-origin forms" note has both recipes and
// records what was observed.

const PORT = Number(process.env.FIXTURE_PORT ?? 3999);
const fixtureUrl = (path: string) => `http://localhost:${PORT}${path}`;

/**
 * Which narrowing the loaded build has, if any:
 *
 * - `''` — the shipped manifest, covering every origin.
 * - `'permissions'` — `host_permissions: ['http://localhost/*']`, content script
 *   `matches` left at `<all_urls>`.
 * - `'both'` — that plus the content script narrowed to `http://localhost/*`.
 */
const NARROWED = process.env.JAC_NARROWED ?? '';

test.describe('a form served from another origin inside an iframe', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    context = await launchWithExtension();
    page = context.pages()[0] ?? (await context.newPage());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  /** Load the fixture, and confirm the browser really did cross an origin. */
  async function openFixture(): Promise<Page> {
    await page.goto(fixtureUrl('/cross-origin-parent.html'));
    const child = page.frames().find((frame) => frame.url().includes('iframe-child.html'));
    expect(child, 'the fixture must have loaded its iframe').toBeTruthy();
    // If this ever fails the fixture has stopped testing what it claims to.
    expect(new URL(child!.url()).hostname).not.toBe(new URL(page.url()).hostname);
    await page.bringToFront();
    return page;
  }

  /**
   * Scan the frame ids Chrome could have given the child, and report what each
   * answered for.
   *
   * Frame ids are not discoverable without host permission for the frame, which
   * is the thing being withheld in the narrowed builds — so they are probed
   * rather than looked up. Chrome gives the top frame both 0 and its real id
   * (1 in this tab), and numbers children from there.
   */
  async function scanByProbingFrameIds(): Promise<{ answered: string[]; failures: string[] }> {
    const answered: string[] = [];
    const failures: string[] = [];
    for (const frameId of [1, 2, 3, 4]) {
      const attempt = await sendToActiveTab<ScanResult>(
        context,
        'TRIGGER_SCAN',
        undefined,
        frameId,
      );
      if (attempt.ok) answered.push(attempt.result.context.url);
      else failures.push(attempt.lastError);
    }
    return { answered, failures };
  }

  test('is detected in its own frame when the manifest covers both origins', async () => {
    test.skip(NARROWED !== '', 'this build does not cover the child origin');
    await openFixture();

    const probe = await reachableFrames(context);
    expect(probe.ok, probe.ok ? '' : `could not enumerate frames: ${probe.error}`).toBe(true);
    if (!probe.ok) return;

    // Both frames are reachable: the extension can inject into the child origin.
    const child = probe.frames.find((frame) => frame.url.includes('127.0.0.1'));
    expect(child, `only reached ${probe.frames.map((f) => f.url).join(', ')}`).toBeTruthy();
    expect(child!.frameId).not.toBe(0);

    // Each frame answers for its own document and nothing more — the content
    // script does not descend into iframes, it is simply running in both.
    const parentScan = await scanActiveTab(context, 0);
    expect(parentScan.fields.map((f) => f.resolvedLabel)).toEqual(['Parent Name']);

    const childScan = await scanActiveTab(context, child!.frameId);
    expect(childScan.fields.map((f) => f.resolvedLabel)).toEqual(['Child Email']);
    expect(childScan.fields[0]!.elementType).toBe('input:email');
    // The job context it built is the frame's own, not the parent's.
    expect(childScan.context.url).toContain('127.0.0.1');
  });

  test('is not offered by the side panel, which reviews the top frame only', async () => {
    await openFixture();
    const panel = await context.newPage();
    try {
      await panel.goto(`chrome-extension://${await extensionId(context)}/sidepanel.html`);
      await page.bringToFront();
      await panel.getByRole('button', { name: 'Scan this page' }).click();

      // The parent's field is reviewable; the cross-origin form's is not, even
      // though the first test proves the extension can read it.
      await expect(panel.getByRole('heading', { name: 'Parent Name' })).toBeVisible();
      await expect(panel.getByRole('heading', { name: 'Child Email' })).toHaveCount(0);
      // Cards are the list items carrying a heading — a flagged card has a
      // bulleted reason list of its own, so `li` alone counts too much.
      const cards = panel.locator('li', { has: panel.getByRole('heading', { level: 2 }) });
      await expect(cards).toHaveCount(1);
    } finally {
      await panel.close();
    }
  });

  test('stays readable when only host_permissions is narrowed, but stops being discoverable', async () => {
    test.skip(NARROWED !== 'permissions', 'needs JAC_NARROWED=permissions; see the README');
    await openFixture();

    // Frame *discovery* is gated by host_permissions: executeScript with
    // allFrames returns the covered frame and no other.
    const probe = await reachableFrames(context);
    expect(probe.ok, probe.ok ? '' : `frame enumeration failed outright: ${probe.error}`).toBe(
      true,
    );
    if (!probe.ok) return;
    expect(probe.frames.map((frame) => frame.url)).toEqual([
      expect.stringContaining('cross-origin-parent.html'),
    ]);

    // Reading the frame, though, is gated by the content script's own `matches`,
    // which still covers it: the script is running there and answers a scan.
    // These are separate grants, and this is the one that decides detection.
    const { answered } = await scanByProbingFrameIds();
    expect(
      answered.some((url) => url.includes('127.0.0.1')),
      `frames answered for: ${answered.join(', ')}`,
    ).toBe(true);
  });

  test('is left alone entirely, without breaking anything, when the content script is narrowed too', async () => {
    test.skip(NARROWED !== 'both', 'needs JAC_NARROWED=both; see the README');
    await openFixture();

    const probe = await reachableFrames(context);
    expect(probe.ok, probe.ok ? '' : `frame enumeration failed outright: ${probe.error}`).toBe(
      true,
    );
    if (!probe.ok) return;
    expect(probe.frames.map((frame) => frame.url)).toEqual([
      expect.stringContaining('cross-origin-parent.html'),
    ]);

    // Nothing in the tab answers for the child origin, and the frames that do
    // not answer fail the way a frame with no listener always fails — a returned
    // error, not a thrown one.
    const { answered, failures } = await scanByProbingFrameIds();
    expect(answered.every((url) => url.includes('localhost'))).toBe(true);
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure).toContain('Could not establish connection');
    }

    // The covered frame still scans: the loss is scoped to one frame.
    const parentScan = await scanActiveTab(context, 0);
    expect(parentScan.fields.map((f) => f.resolvedLabel)).toEqual(['Parent Name']);

    // And the page itself is untouched — the uncovered form is still usable by
    // hand, which is the whole of what the user loses.
    const child = page.frames().find((frame) => frame.url().includes('iframe-child.html'))!;
    await child.fill('#child-email', 'applicant@example.com');
    await expect(child.locator('#child-email')).toHaveValue('applicant@example.com');
  });
});
