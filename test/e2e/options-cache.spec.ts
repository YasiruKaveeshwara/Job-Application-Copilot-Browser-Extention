import { test, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { BUILD_FIRST, extensionBuilt, extensionId, launchWithExtension } from './extension';

// Phase 15: the one piece of the answer cache the user can see and act on.
//
// What the cache actually does — serving a stored draft instead of paying for it
// again — cannot be driven from a plain `npm run build`: with no API key, no
// drafts are ever generated, so nothing is ever cached (the mock generator is a
// compile-time flag). That behaviour is asserted in test/unit, where the
// generator is visible and can be counted: see orchestrator.test.ts ("does not
// pay for the same field, job, and profile twice"). The README's manual recipe
// covers the timing check the build guide asks for.
//
// What this spec covers is the shipped options page: the section mounts, reads
// the real store, and offers nothing to clear when there is nothing cached.

test.describe('the cached-drafts control', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);

  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await launchWithExtension();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('reads the store and says how long a draft is kept', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${await extensionId(context)}/options.html`);

    const section = page.locator('section', { has: page.getByText('Cached drafts') });
    // A count at all means the read succeeded; "Count unavailable" is the failure.
    await expect(section.getByText('0 cached')).toBeVisible();
    await expect(section).toContainText('7 days');

    // Nothing cached, so nothing to clear: the button must not invite a no-op.
    await expect(section.getByRole('button', { name: 'Clear cached drafts' })).toBeDisabled();
  });
});
