import { test, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import {
  BUILD_FIRST,
  extensionBuilt,
  extensionId,
  launchWithExtension,
  readLocalStorage,
} from './extension';

// The CV import path on the shipped options page, driven with no API key.
//
// What only a real build can show is the chain between the pieces the unit tests
// check separately: a picked file reaching `FileReader` in a real extension page,
// the base64 crossing the message boundary to the service worker, and the
// worker's wording coming back as something the user can read. test/unit covers
// the request shape and the mapper; neither can see whether the two halves are
// wired to each other in the bundle Chrome actually loads.
//
// No key is saved here, on purpose: the extractor's config guard refuses before
// it sends anything, so the round trip is exercised without a request, a spend,
// or a fixture CV in the repo.

/** Smallest thing Chrome will hand over as a PDF: a header and a trailer. */
const TINY_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

const NO_KEY = 'No Gemini API key saved. Add one on the extension options page.';

test.describe('importing a CV from the options page', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);

  let context: BrowserContext;

  test.beforeAll(async () => {
    context = await launchWithExtension();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  async function openImportSection() {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${await extensionId(context)}/options.html`);
    const section = page.locator('section', { has: page.getByText('Import from a CV') });
    await expect(section).toBeVisible();
    return { page, section };
  }

  test('states the promise before a file is picked, and takes PDFs only', async () => {
    const { section } = await openImportSection();

    // Visible with no file chosen: the user reads this before deciding to upload.
    await expect(section).toContainText('Nothing is written to your profile until you confirm it');
    await expect(section.locator('input[type=file]')).toHaveAttribute(
      'accept',
      '.pdf,application/pdf',
    );
  });

  test('refuses a file that is not a PDF without reading or sending it', async () => {
    const { section } = await openImportSection();

    await section
      .locator('input[type=file]')
      .setInputFiles({ name: 'cv.docx', mimeType: 'application/msword', buffer: TINY_PDF });

    await expect(section).toContainText('That file is not a PDF');
    await expect(section).toContainText('Export your CV as a PDF');
    // The busy label is set immediately before the read; never showing it is how
    // this spec sees that the guard ran ahead of both the read and the message.
    await expect(section.getByText('Reading the CV…')).toHaveCount(0);
  });

  test('reads a PDF, asks the worker, and shows what the worker said', async () => {
    const { section } = await openImportSection();

    await section
      .locator('input[type=file]')
      .setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: TINY_PDF });

    // This sentence is composed in the extractor, worded by lib/orchestrator.ts
    // in the service worker, and rendered here — so seeing it verbatim means the
    // file was read, the base64 crossed the boundary, and the reply came back.
    // It is not something the options bundle could have produced on its own:
    // `grep` finds it in background.js and nowhere else in the build.
    await expect(section.getByText(NO_KEY)).toBeVisible();

    // And nothing was proposed or kept: no review list, and the picker is clear
    // so the same file can be chosen again once a key is saved.
    await expect(section.getByText('Nothing is saved until you press')).toHaveCount(0);
    await expect(section.locator('input[type=file]')).toHaveValue('');
  });

  test('writes nothing to storage on the way through', async () => {
    const { section } = await openImportSection();

    await section
      .locator('input[type=file]')
      .setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: TINY_PDF });
    await expect(section.getByText(NO_KEY)).toBeVisible();

    // The profile item has a `fallback`, not an `init`, so reading it stores
    // nothing: the key existing at all would mean this page wrote a profile
    // without anyone pressing Confirm or Save.
    const stored = await readLocalStorage(context);
    expect(stored).not.toHaveProperty('profile');
    // Nor is the upload itself kept anywhere — the bytes are passed to the
    // worker and dropped.
    expect(JSON.stringify(stored)).not.toContain('%PDF');
  });
});
