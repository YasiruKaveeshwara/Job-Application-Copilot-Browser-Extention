import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  BUILD_FIRST,
  extensionBuilt,
  extensionId,
  insertIntoActiveTab,
  launchWithExtension,
  reachableFrames,
  readLocalStorage,
  scanActiveTab,
} from './extension';
import type { ScanResult } from '../../lib/messaging';
import type { DetectedField } from '../../lib/types';

// Phase 17: the mechanical half of real-world validation, run against live
// application pages instead of fixtures.
//
// Fixtures are written by the same person who wrote the detector, so they can
// only ever confirm that it does what it was built to do. Real pages are the
// opposite: they were built by people who never heard of this extension, and they
// are where "detects form fields" either survives contact or does not.
//
// WHAT THIS SPEC CAN AND CANNOT DO
// It covers the parts that are objective — are fields found, are the labels the
// ones a human would read off the page, is the job text sensible, does an insert
// land in the site's own form state, does anything submit. It cannot judge
// whether a draft is *good*, which needs a Gemini key and a person reading the
// paragraph; those rows stay manual. See docs/manual-validation.md.
//
// This spec is skipped unless JAC_REAL_PAGES=1, for three reasons: it needs the
// public internet, live postings expire, and a suite that fails because a company
// closed a role is a suite people learn to ignore. It prints a report rather than
// asserting site-specific details, and the report is what gets pasted into
// docs/manual-validation.md.
//
//   npm run build
//   JAC_REAL_PAGES=1 npm run test:e2e -- real-pages
//   # other pages:
//   JAC_REAL_PAGES=1 JAC_REAL_PAGE_URLS="https://…,https://…" npm run test:e2e -- real-pages

const REAL = process.env.JAC_REAL_PAGES === '1';

/**
 * How long a client-rendered form gets to mount before we give up on it.
 *
 * Real application forms are usually React apps that mount well after
 * `domcontentloaded`, so a scan fired the moment `goto` resolves finds an empty
 * document and says "0 fields" — which reads like a detector failure and is not
 * one. The spec polls instead, and reports how long the page took, so a slow site
 * and an undetectable site are distinguishable in the log.
 */
const DETECT_TIMEOUT_MS = Number(process.env.JAC_REAL_PAGE_TIMEOUT_MS ?? 30_000);

/**
 * Live application pages, deliberately varied (build guide, Phase 17).
 *
 * These will rot — postings close. Override with JAC_REAL_PAGE_URLS rather than
 * editing them, and record whatever was actually visited in the log doc.
 */
const DEFAULT_URLS = [
  // A major ATS, form rendered inline on the posting.
  'https://job-boards.greenhouse.io/greenhouse/jobs/8021661',
  // A second major ATS, whose apply form is its own route.
  'https://jobs.lever.co/palantir/ac978161-6f46-4f6b-ad9e-a258e642751c/apply',
  // A modern React ATS whose form is also its own route.
  'https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application',
  // A large company's own careers site rather than an off-the-shelf board.
  'https://explore.jobs.netflix.net/careers/job/790298014263',
  // Worst case: heavy client-side rendering, and the form itself behind a login.
  'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
];

const URLS = (process.env.JAC_REAL_PAGE_URLS ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter((url) => url.length > 0);

/**
 * The page the correction round trip runs against.
 *
 * Pinned to the Greenhouse posting rather than "whichever URL came first": the
 * test needs a page it knows a misclassified field on. Override with
 * JAC_REAL_CORRECTION_URL if this posting closes, and adjust the field name.
 */
const CORRECTION_PAGE = process.env.JAC_REAL_CORRECTION_URL ?? DEFAULT_URLS[0]!;

/** A one-line summary of one field, for the report. */
function describeField(field: DetectedField): string {
  const label = field.resolvedLabel.replace(/\s+/g, ' ').trim();
  return `${field.elementType.padEnd(14)} ${field.labelConfidence.padEnd(10)} ${
    label.length > 0 ? JSON.stringify(label.slice(0, 70)) : '(no label)'
  }`;
}

function report(lines: string[]): void {
  console.log(lines.join('\n'));
}

/**
 * Poll the top frame until it reports a field, and say how long that took.
 *
 * Returns the last scan either way — a page with genuinely no fields (a listing
 * page, a form behind a login) is a legitimate result to report, not an error.
 */
async function waitForFields(
  context: BrowserContext,
  page: Page,
  timeoutMs: number,
): Promise<{ scan: ScanResult; ms: number; timedOut: boolean }> {
  const started = Date.now();
  let scan = await scanActiveTab(context, 0);
  while (scan.fields.length === 0 && Date.now() - started < timeoutMs) {
    await page.waitForTimeout(1_000);
    scan = await scanActiveTab(context, 0);
  }
  return { scan, ms: Date.now() - started, timedOut: scan.fields.length === 0 };
}

test.describe('real application pages', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);
  test.skip(() => !REAL, 'set JAC_REAL_PAGES=1 to run against the live internet');
  // Real pages are slower than fixtures by an order of magnitude.
  test.setTimeout(180_000);

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    context = await launchWithExtension();
    page = context.pages()[0] ?? (await context.newPage());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  for (const url of URLS.length > 0 ? URLS : DEFAULT_URLS) {
    test(`scan report: ${url}`, async () => {
      const lines: string[] = ['', `=== ${url}`];
      // The report is this spec's product, so it is printed even when an
      // assertion below fails — a failure with no report is a failure nobody can
      // act on, and on a live page the report is usually the explanation.
      try {
        await scanReport(url, lines);
      } finally {
        report(lines);
      }
    });
  }

  async function scanReport(url: string, lines: string[]): Promise<void> {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    lines.push(`HTTP ${response?.status() ?? '???'} → ${page.url()}`);
    await page.bringToFront();

    // Wait for the form to mount rather than racing it: how long a page took to
    // become detectable is itself part of the report, and it is what separates a
    // slow SPA from a page whose fields this detector cannot see.
    const settle = await waitForFields(context, page, DETECT_TIMEOUT_MS);
    lines.push(
      settle.timedOut
        ? `top frame: still 0 fields after ${Math.round(settle.ms / 1000)}s`
        : `top frame: first field seen after ${Math.round(settle.ms / 1000)}s`,
    );

    const probe = await reachableFrames(context);
    if (!probe.ok) {
      lines.push(`frames: could not enumerate (${probe.error})`);
      return;
    }
    lines.push(`frames reachable: ${probe.frames.length}`);

    const scans: { frameId: number; url: string; scan: ScanResult }[] = [];
    for (const frame of probe.frames) {
      try {
        scans.push({
          frameId: frame.frameId,
          url: frame.url,
          scan: await scanActiveTab(context, frame.frameId),
        });
      } catch (error) {
        lines.push(
          `  frame ${frame.frameId} (${frame.url}): scan failed — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    for (const { frameId, url: frameUrl, scan } of scans) {
      lines.push(`  frame ${frameId}: ${frameUrl}`);
      lines.push(`    fields: ${scan.fields.length}`);
      for (const field of scan.fields.slice(0, 25)) lines.push(`      ${describeField(field)}`);
      if (scan.fields.length > 25) lines.push(`      … ${scan.fields.length - 25} more`);
      lines.push(`    page title: ${JSON.stringify(scan.context.pageTitle)}`);
      lines.push(`    job text: ${scan.context.rawText.length} chars`);
      lines.push(`    job text head: ${JSON.stringify(scan.context.rawText.slice(0, 220))}`);

      // Every scan must produce a usable job context, whatever the site does.
      expect(scan.context.url.length).toBeGreaterThan(0);
      expect(scan.context.rawText.length).toBeLessThanOrEqual(12_000);
    }

    // Insert into the first free-text field found anywhere in the tab, and read
    // it back from outside the extension — the check that separates a real page
    // from a fixture, since real forms are usually controlled inputs.
    const target = scans
      .flatMap(({ frameId, url: frameUrl, scan }) =>
        scan.fields.map((field) => ({ frameId, frameUrl, field })),
      )
      .find(({ field }) => field.elementType === 'textarea' || field.elementType === 'input:text');

    if (target === undefined) {
      lines.push('  insert: no free-text field on this page to try');
      return;
    }

    const marker = 'Job Application Copilot insert check';
    const before = page.url();
    const result = await insertIntoActiveTab(context, target.field.domRef, marker, target.frameId);
    const frame = page.frames().find((candidate) => candidate.url() === target.frameUrl);
    const live = frame
      ? await frame
          .locator(`[data-jac-id="${target.field.domRef}"]`)
          .inputValue()
          .catch(() => '(could not read back)')
      : '(frame not found by url)';
    lines.push(
      `  insert into ${JSON.stringify(target.field.resolvedLabel.slice(0, 40))} (${
        target.field.elementType
      }): success=${result.success}${
        result.error === undefined ? '' : ` (${result.error})`
      } readback=${JSON.stringify(live)}`,
    );

    // What is asserted is the extension's own contract: the handler confirms the
    // field held the text before it reports success (lib/insert-handler.ts), and
    // an insert never navigates. Whether the value is *still* there a moment
    // later is the site's business — a page that re-mounts its form after load
    // will discard it, which is reported above rather than failed on, because no
    // amount of care in this extension can stop it. insert-handler.spec.ts holds
    // the strict version of this check, against a page that does not fight back.
    expect(result.success, result.error ?? '').toBe(true);
    if (live !== marker) {
      lines.push(`  note: the site discarded the inserted value (${JSON.stringify(live)})`);
    }
    expect(page.url()).toBe(before);
  }

  // Checklist item 4: correct a misclassified field, and have the correction
  // remembered on a second visit to the same site.
  //
  // field-correction.spec.ts already drives this against fixtures, including that
  // two hosts on one server keep separate corrections. What only a real site can
  // add is a real registrable domain as the key, and a genuine misclassification
  // to correct: the field below is the search box *inside* Greenhouse's country
  // combobox, which the detector cannot tell from an application question because
  // structurally it is not one — it is a labelled text input in the form.
  test('remembers a correction made on a real site, across a second visit', async () => {
    // Two full page loads plus two panel scans of a real site, which is more
    // wall-clock than any single-page report above.
    test.setTimeout(300_000);
    const url = CORRECTION_PAGE;
    const openAndScan = async (panel: Page, visit: string): Promise<void> => {
      const started = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      const loaded = Date.now();
      await page.bringToFront();
      const settle = await waitForFields(context, page, DETECT_TIMEOUT_MS);
      // The panel's own button renames itself to Rescan once it has cards, so a
      // second visit is not reachable by the first visit's name.
      await panel.getByRole('button', { name: /^(Scan this page|Rescan)$/ }).click();
      report([
        `  ${visit}: loaded in ${Math.round((loaded - started) / 1000)}s, ${
          settle.scan.fields.length
        } fields after a further ${Math.round(settle.ms / 1000)}s`,
      ]);
    };

    const panel = await context.newPage();
    try {
      await panel.goto(`chrome-extension://${await extensionId(context)}/sidepanel.html`);
      report(['', `=== correction round trip on ${url}`]);
      await openAndScan(panel, 'first visit');
      const host = new URL(page.url()).hostname;

      const card = panel
        .locator('li', { has: panel.getByRole('heading', { name: 'Search', exact: true }) })
        .first();
      await expect(card, `no "Search" field on ${url}; the page may have changed`).toBeVisible({
        timeout: 20_000,
      });
      const label = (await card.getByRole('heading').first().textContent()) ?? '';

      await card.getByPlaceholder('e.g. work-authorization').fill('not-an-application-question');
      await card.getByRole('button', { name: 'Remember for this site' }).click();
      await expect(card.getByText(`Saved for ${host}`)).toBeVisible();

      // Second visit: a fresh load and a fresh scan, and the correction is still
      // stored against this host — which is what the next generation reads.
      await openAndScan(panel, 'second visit');
      await expect(panel.getByRole('heading', { name: 'Search', exact: true }).first()).toBeVisible(
        {
          timeout: 20_000,
        },
      );

      const stored = (await readLocalStorage(context)).fieldMappings as Record<
        string,
        { resolvedLabel: string; correctedType: string }[]
      >;
      report([`  stored for ${host}: ${JSON.stringify(stored[host])}`]);
      expect(stored[host]).toContainEqual({
        resolvedLabel: label,
        correctedType: 'not-an-application-question',
      });
    } finally {
      await panel.close();
    }
  });
});
