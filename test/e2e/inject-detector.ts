import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Frame, Page } from '@playwright/test';
import type { DetectedField } from '../../lib/types';

// lib/field-detector.ts imports only types, so it transpiles to a standalone
// module with no runtime dependencies. That lets the real detector source run
// inside a real browser frame — including cross-frame — without shipping a
// separate test build step.
const SOURCE_PATH = fileURLToPath(new URL('../../lib/field-detector.ts', import.meta.url));

let cachedBundle: string | undefined;

function detectorBundle(): string {
  if (cachedBundle) return cachedBundle;
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  // Expose the module's exports as a single global for the page to call.
  cachedBundle = `(() => { const exports = {}; ${outputText}; globalThis.JAC = exports; })()`;
  return cachedBundle;
}

/** Inject the detector into a specific frame and return its detected fields. */
export async function detectInFrame(frame: Frame | Page): Promise<DetectedField[]> {
  await frame.evaluate(detectorBundle());
  return (await frame.evaluate('JAC.detectFields(document)')) as DetectedField[];
}

/** Inject the detector and return the frame's extracted page text. */
export async function pageTextInFrame(frame: Frame | Page): Promise<string> {
  await frame.evaluate(detectorBundle());
  return (await frame.evaluate('JAC.extractPageText()')) as string;
}
