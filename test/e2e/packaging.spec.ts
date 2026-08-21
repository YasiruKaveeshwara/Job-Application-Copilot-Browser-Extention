import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_FIRST, EXTENSION_DIR, extensionBuilt } from './extension';

// Phase 18: what `npm run build` actually produced.
//
// Every other spec in this directory loads the unpacked build and drives it, so
// they answer "does the shipped extension work". None of them answer "is there
// anything in the shipped extension that should not be" — and that question has
// a specific edge to it here, because this project has a build-time flag that
// swaps the real generator for a stub (lib/generator/index.ts). A flag like that
// is exactly how a dev-only code path ends up in a release, so it is asserted
// rather than assumed, in both directions: the mock's own strings must be absent
// and the real endpoint must be present.
//
// The rest is packaging hygiene that is cheap to check and expensive to notice by
// hand: the manifest pointing at files that exist, permissions staying the set
// that was reviewed, no source maps or dev-server client, nothing key-shaped, and
// git ignoring the output directory and env files (build guide, section 0, rule
// 4). No browser is needed for any of it.

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  background?: { service_worker?: string };
  options_ui?: { page?: string };
  side_panel?: { default_path?: string };
  content_scripts?: { matches?: string[]; all_frames?: boolean; js?: string[] }[];
  web_accessible_resources?: unknown[];
}

/** Every file in the unpacked build, as build-root-relative posix paths. */
function buildFiles(dir = EXTENSION_DIR, prefix = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix === '' ? entry : posix.join(prefix, entry);
    return statSync(full).isDirectory() ? buildFiles(full, rel) : [rel];
  });
}

function readBuilt(path: string): string {
  return readFileSync(join(EXTENSION_DIR, path), 'utf8');
}

/** Every bundled file whose contents are text worth scanning. */
function textFiles(): { path: string; text: string }[] {
  return buildFiles()
    .filter((path) => /\.(js|css|html|json)$/.test(path))
    .map((path) => ({ path, text: readBuilt(path) }));
}

function manifest(): Manifest {
  return JSON.parse(readBuilt('manifest.json')) as Manifest;
}

/** Where each `needle` turns up in the build, so a failure names the file. */
function occurrences(needle: string | RegExp): string[] {
  return textFiles()
    .filter(({ text }) => (typeof needle === 'string' ? text.includes(needle) : needle.test(text)))
    .map(({ path }) => path);
}

/**
 * Every class the shipped stylesheet defines a rule for, spelled as it would be
 * written in markup.
 *
 * Takes the leading class of each selector in each rule and undoes Tailwind's
 * escaping, so `.hover\:bg-gray-100:hover` yields `hover:bg-gray-100` and
 * `.space-y-2>:not([hidden])` yields `space-y-2` — i.e. the token an author would
 * have had to type for the rule to exist.
 */
function styledClasses(): string[] {
  const css = textFiles()
    .filter(({ path }) => path.endsWith('.css'))
    .map(({ text }) => text)
    .join('\n');
  const tokens = new Set<string>();
  for (const rule of css.matchAll(/([^{}();]+)\{/g)) {
    const selectorList = rule[1]!.trim();
    if (selectorList.startsWith('@') || selectorList.length === 0) continue;
    for (const selector of selectorList.split(',')) {
      const leading = /^\s*\.((?:[^\s.,:>+~[\]()\\]|\\.)+)/.exec(selector);
      if (leading !== null) tokens.add(leading[1]!.replace(/\\/g, ''));
    }
  }
  return [...tokens];
}

/** Every UI source file's text, concatenated — the only place classes are written. */
function uiSource(dir = join(REPO_ROOT, 'entrypoints')): string {
  return readdirSync(dir)
    .map((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return uiSource(full);
      return /\.(tsx?|html|css)$/.test(entry) ? readFileSync(full, 'utf8') : '';
    })
    .join('\n');
}

test.describe('the unpacked production build', () => {
  test.skip(() => !extensionBuilt(), BUILD_FIRST);

  test('contains only built assets — no sources, maps, or env files', () => {
    const files = buildFiles();
    // The entrypoint names are fixed by the manifest; chunk names carry content
    // hashes, so this asserts on the shape of the set rather than the exact list.
    expect(files).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'background.js',
        'content-scripts/content.js',
        'options.html',
        'sidepanel.html',
      ]),
    );
    const unexpected = files.filter((path) => !/\.(js|css|html|json)$/.test(path));
    expect(unexpected, `unexpected files in the build: ${unexpected.join(', ')}`).toEqual([]);
    // Source maps would ship the original source, including comments, inside the
    // extension a user installs.
    expect(occurrences('sourceMappingURL')).toEqual([]);
  });

  test('points every path it declares at a file that exists', () => {
    const built = new Set(buildFiles());
    const parsed = manifest();
    const declared = [
      parsed.background?.service_worker,
      parsed.options_ui?.page,
      parsed.side_panel?.default_path,
      ...(parsed.content_scripts ?? []).flatMap((script) => script.js ?? []),
    ].filter((path): path is string => path !== undefined);

    // Every entrypoint the manifest names, plus everything the HTML documents
    // pull in — a stale chunk reference is the packaging bug this catches, and it
    // is invisible until the page is opened.
    const referenced = declared.filter((path) => path.endsWith('.html'));
    const assets = referenced.flatMap((page) =>
      [...readBuilt(page).matchAll(/(?:src|href)="([^"]+)"/g)].map((match) =>
        match[1]!.replace(/^\//, ''),
      ),
    );

    expect(declared.length).toBeGreaterThan(0);
    expect(assets.length).toBeGreaterThan(0);
    for (const path of [...declared, ...assets]) {
      expect(built.has(path), `manifest or a built page references a missing ${path}`).toBe(true);
    }
  });

  test('declares the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest().version).toBe(pkg.version);
    expect(manifest().manifest_version).toBe(3);
  });

  test('asks for only the permissions that were reviewed', () => {
    const parsed = manifest();
    // sidePanel is added by WXT from the sidepanel entrypoint; the other three are
    // declared in wxt.config.ts. Anything else appearing here is a review event —
    // this extension reads and writes form fields on every site the user visits,
    // so the permission set is the whole of what limits it.
    expect([...(parsed.permissions ?? [])].sort()).toEqual([
      'activeTab',
      'scripting',
      'sidePanel',
      'storage',
    ]);
    expect(parsed.host_permissions).toEqual(['<all_urls>']);
    // webNavigation would make frame enumeration easier (getAllFrames) and is
    // deliberately not requested; Phase 16 established that executeScript is
    // enough. tabs would hand over browsing history for no gain here.
    for (const permission of ['webNavigation', 'tabs', 'management', 'downloads', 'cookies']) {
      expect(parsed.permissions ?? []).not.toContain(permission);
    }
    // No resources are exposed to page scripts: nothing in the build should be
    // reachable from a job site's own JavaScript.
    expect(parsed.web_accessible_resources ?? []).toEqual([]);
    // Detection has to work on arbitrary sites and inside their frames.
    expect(parsed.content_scripts?.[0]?.matches).toEqual(['<all_urls>']);
    expect(parsed.content_scripts?.[0]?.all_frames).toBe(true);
  });

  test('has the real generator wired in and no trace of the mock', () => {
    // The negative half: MockGenerator's own strings, and MockExtractor's — the
    // same build-time flag swaps both (lib/generator/index.ts,
    // lib/extractor/index.ts). `VITE_USE_MOCK_GENERATOR` is included because the
    // flag name surviving into the bundle means it is being read at runtime rather
    // than substituted at build time — which is how the mock got shipped before
    // Phase 18, decided by an environment variable that a release build has no
    // business consulting.
    for (const needle of [
      'Mock draft for',
      'MockGenerator',
      'VITE_USE_MOCK_GENERATOR',
      'MockExtractor',
      // The canned CV's own marker: if a review screen ever shows this address,
      // the mock extractor is answering in a build a user installed.
      'mock.candidate@example.com',
    ]) {
      expect(occurrences(needle), `${needle} is in the build`).toEqual([]);
    }
    // The positive half. Absence of the mock would also be satisfied by a build
    // with no generator at all, so the real endpoint is asserted present. It
    // appears in exactly one bundle: both the answer generator and the CV
    // extractor run in the background, so no page ever holds the API key or the
    // provider URL.
    expect(occurrences('generativelanguage.googleapis.com')).toEqual(['background.js']);
  });

  test('has no dev-server or hot-reload code path in it', () => {
    // A production build that still carries the Vite client or WXT's reloader
    // would try to talk to a dev server that is not running, on a user's machine.
    for (const needle of [
      '@vite/client',
      'wxt/dev',
      'import.meta.hot',
      'ws://localhost',
      'localhost:3000',
      'localhost:3999',
    ]) {
      expect(occurrences(needle), `${needle} is in the build`).toEqual([]);
    }
  });

  test('contains nothing shaped like an API key', () => {
    // A real Gemini key is `AIza` followed by 35 more characters. The options
    // page's placeholder is the literal `AIza…`, which is why this matches on the
    // shape rather than the prefix: the point is to fail if a key was ever hard
    // coded or captured into a committed .env that the build read.
    expect(occurrences(/AIza[0-9A-Za-z_-]{20,}/)).toEqual([]);
    // The key belongs in extension storage, entered by the user, and nowhere else.
    expect(occurrences(/\bGEMINI_API_KEY\b/)).toEqual([]);
  });

  test('styles only classes the UI actually uses', () => {
    // Tailwind's automatic source detection reads the whole project, so before
    // assets/tailwind.css pinned its sources this stylesheet carried ~1.9 kB of
    // rules harvested from prose in specs and markdown — `.container` from the
    // word "container", `.shadow` from "shadow DOM", `.filter` from "noise
    // filter". Harmless, and still dev-only bytes shipped to users.
    //
    // Asserted as an invariant rather than a list of known-bad names: every class
    // the stylesheet defines must appear somewhere in the UI source. If source
    // detection ever goes back to discovering files, whatever it harvests will not
    // be found in entrypoints/ and this fails with the names it invented.
    const source = uiSource();
    const unused = styledClasses().filter((token) => !source.includes(token));
    expect(unused, `styles for classes no UI file mentions: ${unused.join(', ')}`).toEqual([]);
  });

  test('is ignored by git, along with env files', () => {
    // Build guide, section 0, rule 4: never commit an API key, a .env file, or
    // anything under the build output directory. Asserted through git itself
    // rather than by reading .gitignore, so it covers every ignore source.
    const shouldBeIgnored = [
      '.output/chrome-mv3/manifest.json',
      '.output/chrome-mv3/background.js',
      '.env',
      '.env.local',
      '.wxt/tsconfig.json',
    ];
    const ignored = execFileSync('git', ['check-ignore', ...shouldBeIgnored], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => line.trim().length > 0);
    expect(ignored.map((path) => path.replace(/\\/g, '/'))).toEqual(shouldBeIgnored);

    // And nothing from the output directory ever got committed by accident.
    const tracked = execFileSync('git', ['ls-files', '--', '.output', '.env', '.env.*'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(tracked.trim()).toBe('');
  });
});
