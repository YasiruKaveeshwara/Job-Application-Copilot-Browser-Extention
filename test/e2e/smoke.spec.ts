import { test, expect } from '@playwright/test';

// Phase 1 smoke check: proves the Playwright config + fixture web server wire
// up correctly. Real extension E2E specs arrive in Phase 6+.
test('fixture server serves the index page', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('h1')).toHaveText('Test Fixtures');
});
