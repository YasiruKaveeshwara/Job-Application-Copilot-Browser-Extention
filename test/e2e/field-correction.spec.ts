import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  BUILD_FIRST,
  extensionBuilt,
  extensionId,
  launchWithExtension,
  readLocalStorage,
} from './extension';

// Phase 14: correcting a field in the real side panel and having the correction
// remembered for the site. This drives the shipped panel, the shipped
// SAVE_FIELD_MAPPING handler, and the extension's own storage.
//
// The part of the phase's acceptance this cannot cover is the corrected
// *classification* appearing on a second scan: the classification comes from the
// model, and a build without an API key never gets one (the mock generator is a
// compile-time flag — see the README's manual recipe). What is asserted instead
// is the whole chain up to that point: the correction is persisted, keyed by the
// site, and read back on the next generation, which test/unit covers at the
// prompt level.
//
// The panel's other branch — a field with no label, where there is no key to
// remember a correction against — has no fixture that can produce it: the
// detector's proximity fallback labels every field on no-label.html (see
// field-detector.spec.ts). That branch is covered in test/unit/panel-state.

const PORT = Number(process.env.FIXTURE_PORT ?? 3999);
const fixtureUrl = (path: string) => `http://localhost:${PORT}${path}`;

test.describe('remembering a manual correction', () => {
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

  test('saves what the user says the field really asks for, keyed by site', async () => {
    await page.goto(fixtureUrl('/standard-labels.html'));
    const panel = await context.newPage();
    try {
      await panel.goto(`chrome-extension://${await extensionId(context)}/sidepanel.html`);
      // The panel scans the active tab, so the fixture has to be the one in front.
      await page.bringToFront();
      await panel.getByRole('button', { name: 'Scan this page' }).click();

      const card = panel
        .locator('li', { has: panel.getByRole('heading', { name: 'Cover Letter' }) })
        .first();
      // The correction control appears on cards that need review, which every
      // card does here: no key, so no draft came back for any of them.
      const correction = card.getByPlaceholder('e.g. work-authorization');
      await expect(correction).toBeVisible();
      const remember = card.getByRole('button', { name: 'Remember for this site' });
      // Nothing to remember yet.
      await expect(remember).toBeDisabled();

      await correction.fill('cover letter');
      await expect(remember).toBeEnabled();
      await remember.click();

      // The panel confirms what was saved and where, rather than just going quiet.
      await expect(card.getByText(/Saved for localhost/)).toBeVisible();

      const stored = await readLocalStorage(context);
      expect(stored.fieldMappings).toEqual({
        localhost: [{ resolvedLabel: 'Cover Letter', correctedType: 'cover letter' }],
      });
    } finally {
      await panel.close();
    }
  });

  test('keys the correction to the host it was made on, not the page', async () => {
    // The same fixture server, reached by its other hostname: one origin's
    // corrections must not become another's, and a site's own corrections must
    // survive a different path (the second host uses a different fixture page).
    await page.goto(`http://127.0.0.1:${PORT}/aria-only.html`);
    const panel = await context.newPage();
    try {
      await panel.goto(`chrome-extension://${await extensionId(context)}/sidepanel.html`);
      await page.bringToFront();
      await panel.getByRole('button', { name: 'Scan this page' }).click();

      const card = panel.locator('li').first();
      const label = (await card.getByRole('heading').first().textContent()) ?? '';
      expect(label.length).toBeGreaterThan(0);

      await card.getByPlaceholder('e.g. work-authorization').fill('work-authorization');
      await card.getByRole('button', { name: 'Remember for this site' }).click();
      await expect(card.getByText(/Saved for 127\.0\.0\.1/)).toBeVisible();

      const stored = (await readLocalStorage(context)).fieldMappings as Record<
        string,
        { resolvedLabel: string; correctedType: string }[]
      >;
      expect(stored['127.0.0.1']).toEqual([
        { resolvedLabel: label, correctedType: 'work-authorization' },
      ]);
      // localhost is the same server; it must not have picked this up.
      expect(stored['localhost'] ?? []).not.toContainEqual(
        expect.objectContaining({ correctedType: 'work-authorization' }),
      );
    } finally {
      await panel.close();
    }
  });
});
