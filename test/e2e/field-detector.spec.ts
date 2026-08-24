import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectInFrame, pageTextInFrame } from './inject-detector';

// Real-browser detector checks. Shadow DOM and iframe behavior need a real
// engine (and real layout for the geometric fallback), not a headless DOM.

test('standard-labels.html detects every field with structured labels', async ({ page }) => {
  await page.goto('/standard-labels.html');
  const fields = await detectInFrame(page);

  const byLabel = new Map(fields.map((f) => [f.resolvedLabel, f]));
  expect([...byLabel.keys()].sort()).toEqual(['Cover Letter', 'Email Address', 'Full Name'].sort());

  expect(byLabel.get('Full Name')?.labelConfidence).toBe('structured');
  expect(byLabel.get('Full Name')?.elementType).toBe('input:text');
  expect(byLabel.get('Email Address')?.elementType).toBe('input:email');
  expect(byLabel.get('Cover Letter')?.elementType).toBe('textarea');

  // The plain <div> of descriptive text must not be detected as a field.
  expect(fields.every((f) => f.elementType !== 'div')).toBe(true);
  // Dropdowns (<select>) are excluded from detection.
  expect(fields.every((f) => f.elementType !== 'select')).toBe(true);
});

test('aria-only.html resolves labels from aria-label and aria-labelledby', async ({ page }) => {
  await page.goto('/aria-only.html');
  const fields = await detectInFrame(page);

  const labels = fields.map((f) => f.resolvedLabel).sort();
  expect(labels).toEqual(['LinkedIn URL', 'Phone Number']);
  // Both ARIA paths count as structured.
  expect(fields.every((f) => f.labelConfidence === 'structured')).toBe(true);
});

test('no-label.html falls back to proximity with non-empty labels', async ({ page }) => {
  await page.goto('/no-label.html');
  const fields = await detectInFrame(page);

  expect(fields).toHaveLength(3);
  // Every field still gets a usable label, and none claim to be structured.
  for (const field of fields) {
    expect(field.resolvedLabel.length).toBeGreaterThan(0);
    expect(field.labelConfidence).not.toBe('structured');
  }

  const byRef = new Map(
    await Promise.all(
      fields.map(async (f) => {
        const id = await page.getAttribute(`[data-jac-id="${f.domRef}"]`, 'id');
        return [id, f] as const;
      }),
    ),
  );
  expect(byRef.get('experience')?.resolvedLabel).toBe('Years of Experience');
  expect(byRef.get('portfolio')?.resolvedLabel).toBe('Portfolio Website');
  // The bare input must not steal the previous field's label.
  expect(byRef.get('unlabeled')?.resolvedLabel).not.toBe('Portfolio Website');
});

test('shadow-dom.html finds the input inside the open shadow root', async ({ page }) => {
  await page.goto('/shadow-dom.html');
  const fields = await detectInFrame(page);

  expect(fields).toHaveLength(1);
  expect(fields[0]!.resolvedLabel).toBe('Shadow Field');
  expect(fields[0]!.labelConfidence).toBe('structured');
  expect(fields[0]!.elementType).toBe('input:text');
});

test('iframe-parent.html detects fields in both the parent and the child frame', async ({
  page,
}) => {
  await page.goto('/iframe-parent.html');

  const childFrame = page.frames().find((f) => f.url().includes('iframe-child.html'));
  expect(childFrame, 'child frame should be present').toBeTruthy();

  const parentFields = await detectInFrame(page.mainFrame());
  const childFields = await detectInFrame(childFrame!);

  // The parent frame sees only its own field — iframe content is a separate
  // document, which is exactly why the content script needs all_frames.
  expect(parentFields.map((f) => f.resolvedLabel)).toEqual(['Parent Name']);
  expect(childFields.map((f) => f.resolvedLabel)).toEqual(['Child Email']);
  expect(childFields[0]!.elementType).toBe('input:email');
});

test('the built manifest is configured to run the content script in all frames', async () => {
  const manifestPath = fileURLToPath(
    new URL('../../.output/chrome-mv3/manifest.json', import.meta.url),
  );
  test.skip(!existsSync(manifestPath), 'run `npm run build` first to generate the manifest');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // If iframe fields are ever missed at runtime, check these before suspecting
  // the detection logic (build guide, Phase 6).
  expect(manifest.content_scripts?.[0]?.all_frames).toBe(true);
  expect(manifest.host_permissions).toContain('<all_urls>');
});

test('extractPageText returns the visible job text within budget', async ({ page }) => {
  await page.goto('/standard-labels.html');
  const text = await pageTextInFrame(page);

  expect(text).toContain('Application form');
  expect(text.length).toBeLessThanOrEqual(12_000);
});
