import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import {
  BUILD_FIRST,
  extensionBuilt,
  insertIntoActiveTab,
  launchWithExtension,
  scanActiveTab,
} from './extension';

// Phase 13: INSERT_FIELD against the real extension. The interesting case is a
// framework-controlled input, where a plain `.value = x` leaves the DOM showing
// the text while the framework's own state stays stale — so every assertion here
// is against what the page renders from its state, not the raw DOM value.

const PORT = Number(process.env.FIXTURE_PORT ?? 3999);
const fixtureUrl = (path: string) => `http://localhost:${PORT}${path}`;

const ANSWER = 'I ship offline-first mobile apps, mostly React Native.';

/** The domRef of the detected field with this label. Fails loudly if absent. */
async function refFor(context: BrowserContext, label: string): Promise<string> {
  const scan = await scanActiveTab(context);
  const field = scan.fields.find((f) => f.resolvedLabel === label);
  expect(field, `no detected field labelled "${label}"`).toBeDefined();
  return field!.domRef;
}

test.describe('inserting a reviewed answer', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);

  let context: BrowserContext;
  /** The tab under test, kept active: an insert addresses the active tab. */
  let page: Page;

  test.beforeAll(async () => {
    context = await launchWithExtension();
    page = context.pages()[0] ?? (await context.newPage());
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("updates React's own state, not just the DOM value", async () => {
    await page.goto(fixtureUrl('/react-controlled-input.html'));
    // The fixture mounts React from a CDN; wait for its first render.
    await expect(page.locator('#react-state-mirror')).toBeAttached();

    const result = await insertIntoActiveTab(
      context,
      await refFor(context, 'React Controlled'),
      ANSWER,
    );

    expect(result).toEqual({ success: true });
    // The mirror is rendered from React state, so this passes only if React
    // itself processed the change.
    await expect(page.locator('#react-state-mirror')).toHaveText(ANSWER);
    await expect(page.locator('#react-input')).toHaveValue(ANSWER);
  });

  test('a plain assignment would not have been enough (control)', async () => {
    await page.goto(fixtureUrl('/react-controlled-input.html'));
    await expect(page.locator('#react-state-mirror')).toBeAttached();

    // What the handler deliberately does not do.
    await page.evaluate(() => {
      (document.querySelector('#react-input') as HTMLInputElement).value = 'naive assignment';
    });

    // The DOM shows the text — and React's state is still empty, which is the
    // stale-state bug the native setter plus input event exists to avoid. If this
    // ever fails, the test above has stopped proving anything.
    await expect(page.locator('#react-input')).toHaveValue('naive assignment');
    await expect(page.locator('#react-state-mirror')).toHaveText('');
  });

  test('fills a plain input, a textarea, and a dropdown on an ordinary form', async () => {
    await page.goto(fixtureUrl('/standard-labels.html'));

    expect(
      await insertIntoActiveTab(context, await refFor(context, 'Full Name'), 'Yasiru'),
    ).toEqual({ success: true });
    await expect(page.locator('#full-name')).toHaveValue('Yasiru');

    const letter = 'First paragraph.\n\nSecond paragraph.';
    expect(
      await insertIntoActiveTab(context, await refFor(context, 'Cover Letter'), letter),
    ).toEqual({ success: true });
    await expect(page.locator('#cover-letter')).toHaveValue(letter);

    // A dropdown can only hold one of its own options, so the draft is matched
    // against them rather than written in as text.
    expect(
      await insertIntoActiveTab(context, await refFor(context, 'Country'), 'Sri Lanka'),
    ).toEqual({ success: true });
    await expect(page.locator('#country')).toHaveValue('lk');
  });

  test('refuses a dropdown option the page does not offer, leaving it untouched', async () => {
    await page.goto(fixtureUrl('/standard-labels.html'));
    const ref = await refFor(context, 'Country');
    await page.selectOption('#country', 'us');

    const result = await insertIntoActiveTab(context, ref, 'Atlantis');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not one of this dropdown's options/);
    await expect(page.locator('#country')).toHaveValue('us');
  });

  test('reaches a field inside an open shadow root', async () => {
    await page.goto(fixtureUrl('/shadow-dom.html'));

    const result = await insertIntoActiveTab(
      context,
      await refFor(context, 'Shadow Field'),
      'reached it',
    );

    expect(result).toEqual({ success: true });
    await expect(page.locator('my-field input')).toHaveValue('reached it');
  });

  test('reports a field that has left the page instead of failing silently', async () => {
    await page.goto(fixtureUrl('/standard-labels.html'));
    const ref = await refFor(context, 'Full Name');
    // Single-page application navigation, or a re-rendered form.
    await page.evaluate(() => {
      document.body.innerHTML = '<p>The form was replaced.</p>';
    });

    const result = await insertIntoActiveTab(context, ref, ANSWER);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no longer on the page/i);
    expect(result.error).toMatch(/[Rr]escan/);
  });
});
