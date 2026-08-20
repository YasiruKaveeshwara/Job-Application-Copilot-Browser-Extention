import { test, expect } from '@playwright/test';

// Phase 5 acceptance: every fixture loads standalone with no console errors and
// is served by the fixture web server. Each entry names a selector that must be
// present once the page has loaded.
const FIXTURES: { path: string; present: string }[] = [
  { path: '/standard-labels.html', present: 'label[for="full-name"]' },
  { path: '/aria-only.html', present: 'input[aria-label="Phone Number"]' },
  { path: '/no-label.html', present: '#experience' },
  { path: '/shadow-dom.html', present: 'my-field' },
  { path: '/iframe-parent.html', present: 'iframe' },
  { path: '/iframe-child.html', present: '#child-email' },
  { path: '/react-controlled-input.html', present: '#react-input' },
];

for (const fx of FIXTURES) {
  test(`fixture ${fx.path} loads with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(fx.path);
    // Auto-waits — also confirms React mounted for the controlled-input fixture.
    await expect(page.locator(fx.present).first()).toBeAttached();

    expect(errors, `console errors on ${fx.path}:\n${errors.join('\n')}`).toHaveLength(0);
  });
}
