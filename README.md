# Job Application Copilot

A browser extension (Manifest V3) that detects fields on job-application pages and
drafts answers from your own profile using the Google Gemini API
(bring-your-own-key). It never auto-submits and never bulk-applies — you review,
edit, and insert every answer yourself.

## Features

- **Universal field detection** — finds form inputs, textareas, ARIA-labelled elements, and inputs inside shadow DOM. Resolves labels via `label[for]`, `aria-label`/`aria-labelledby`, and proximity fallback.
- **Profile-driven drafts** — retrieves the most relevant fragments from your work history, projects, and standard answers for each field before calling the model.
- **CV import with explicit confirmation** — upload a PDF CV and the model reads what it can off it; every extracted value is shown grouped by category, editable, and unticked wherever it would change something you typed. Nothing is saved until you confirm. See [Importing a CV](#importing-a-cv).
- **Bring-your-own-key** — your Gemini API key lives in local extension storage only. It is never synced to your browser account.
- **Answer cache** — identical (field, role type, site) combinations reuse the previous draft until your profile changes or 7 days pass.
- **Learned corrections** — manually correct a misclassified field label once and the correction is remembered per site.
- **No auto-submit, no bulk apply** — you insert each answer yourself after reading it.

## Tech stack

- **[WXT](https://wxt.dev)** — MV3 extension framework (Vite + TypeScript)
- **React + Tailwind CSS** — options page and side panel UI
- **[@webext-core/messaging](https://webext-core.aklinker1.io/messaging/)** — typed message contracts
- **Google Gemini API** — `generativelanguage.googleapis.com/v1beta` (bring-your-own-key)
- **Vitest** — unit tests · **Playwright** — E2E tests

## Setup

A fresh clone needs two commands and your own API key:

```bash
npm install && npm run build
```

then load `.output/chrome-mv3/` unpacked in Chrome and paste your key into the
options page. The long version, step by step:

### 1. Install dependencies

```bash
npm install
```

`postinstall` runs `wxt prepare` automatically.

### 2. Get a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create a key.
2. **Never commit the key to git.** `.env` and `.env.local` are already in `.gitignore`.

### 3. Build or run the dev server

```bash
# Development (hot-reload, unpacked extension):
npm run dev

# Production build:
npm run build
```

### 4. Load the extension in Chrome

1. Navigate to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `.output/chrome-mv3/`.

### 5. Enter your API key

1. Click the puzzle-piece menu and open **Job Application Copilot → Options**.
2. Paste your Gemini API key and choose a model.
3. Fill in your profile (personal info, work history, projects, etc.) — or start it
   from a CV, see [Importing a CV](#importing-a-cv).
4. Click **Save**.

> **Security warning:** your API key is stored only in local extension storage on this device. Never commit it to a repository, never paste it into a `.env` file that gets checked in, and never share it.

## Importing a CV

The options page can fill in the profile from a PDF CV instead of by typing.
Upload one under **Import from a CV**; the file is sent to the Gemini API with the
same key as everything else, and the model returns whatever structured data it can
read off the document.

**Nothing is written to your profile until you confirm it.** What comes back is
shown as a review list grouped by category — Personal, Education, Work history,
Projects, Skills — where every value is editable in place and every item has a
checkbox:

- A target that is **empty** yields a **New** item, ticked by default.
- A target that **already has something in it** yields a **Proposed change**,
  unticked, showing what is already saved next to what the CV says. Nothing is
  ever replaced or quietly appended to a section you filled in by hand.
- Anything the profile already holds — the same value, school, employer, project,
  or skill — is left out, so re-importing the same CV produces an empty review
  rather than a duplicated profile.

Pressing **Confirm** applies only the ticked items and saves. Discarding the
import, or closing the page, writes nothing.

### What a CV import never touches

Five parts of a profile are framing decisions a document cannot state, so they
are never populated from one:

| Field                              | Why not                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `individualOrGroup` (per project)  | A CV rarely says; you are asked per project during the review |
| `narrativeFragments` (per project) | How you tell the story is yours to write                      |
| `standardAnswers`                  | Your answers to recurring questions, not a document's         |
| `stylePreferences`                 | Tone and length are your call                                 |
| `resumeVariants`                   | Which CV to attach where is a decision, not extracted data    |

This is enforced, not just documented: the extraction request never shows the model
a slot for those fields, and a response that contains one is **rejected** rather
than cleaned up ([lib/extractor/schema.ts](lib/extractor/schema.ts)), so a drifting
prompt or a changed model cannot look like a correct one.

Other non-goals: no auto-save at any point, no local PDF parsing (the model reads
the document; the extension ships no PDF library), and no storage of the file —
it is read once, in the background service worker, and not kept.

## Development commands

```bash
npm run dev          # dev server + unpacked extension (hot-reload)
npm run build        # production build → .output/chrome-mv3/
npm run zip          # build, then package it → .output/*.zip
npm run typecheck    # wxt prepare && tsc --noEmit
npm run lint         # eslint (0 warnings = passing)
npm run test         # vitest unit tests (313 tests)
npm run test:e2e     # playwright e2e tests (requires built extension)
npm run format       # prettier --write
```

`npm run test:e2e` starts the fixture server itself (`playwright.config.ts`), but
it does **not** build — it loads `.output/chrome-mv3/`, so run `npm run build`
first or the specs skip themselves with a message telling you to.

## Reviewing the panel without an API key (mock mode)

`VITE_USE_MOCK_GENERATOR=true` swaps the real generator for a deterministic stub,
so the full scan → draft → review round trip works with no key and no spend:

```bash
VITE_USE_MOCK_GENERATOR=true npm run dev
```

The same flag swaps the CV extractor for a canned one, so the import review screen
can be exercised with any PDF (its contents are ignored) and no API call.

The flag is read at build time, not runtime: a plain `npm run build` compiles the
comparison to `false` and both stubs are dropped from the bundle entirely, so a
release build has no path back to them. `test/e2e/packaging.spec.ts` asserts that —
and asserts the real Gemini endpoint is present in `background.js` and nowhere
else, since "no mock" would also be true of a build with no generator at all.

Then serve the test fixtures:

```bash
node test/e2e/static-server.mjs   # serves test-fixtures/ on http://localhost:3999
```

Open `http://localhost:3999/standard-labels.html` in Chrome, click the toolbar
button to open the side panel, and press **Scan this page**.

## Models

| Model ID                | Notes                        |
| ----------------------- | ---------------------------- |
| `gemini-3.7-flash`      | Default — best draft quality |
| `gemini-3.5-flash`      | Middle ground                |
| `gemini-3.5-flash-lite` | Fastest and cheapest         |
| `gemini-2.5-flash`      | Older stable                 |

Any valid Gemini model ID can be typed into the model field in the options page.

## What ships in a build

`npm run build` writes nine files to `.output/chrome-mv3/` — a manifest, the
service worker, the content script, the two extension pages and their chunks —
totalling ~290 kB, of which two thirds is React. `npm run zip` packages the same
output for distribution.

`test/e2e/packaging.spec.ts` checks the artifact rather than the source, because a
few things can only go wrong at packaging time:

- **No dev-only code paths.** No mock generator, no Vite client, no hot-reload
  hook, no source maps — a source map would ship this repo's source, comments and
  all, inside the extension.
- **Nothing key-shaped.** Nothing matching a Gemini key (`AIza…` plus 35
  characters) appears in any bundled file. Your key belongs in extension storage,
  which is written by the options page at runtime and never read by the build.
- **The permission set that was reviewed**, and no more: `storage`, `scripting`,
  `activeTab`, `sidePanel`. Not `tabs`, not `webNavigation` — Phase 16 established
  that `chrome.scripting` alone is enough to reach frames.
- **No stale references.** Every path the manifest and both HTML pages point at
  exists in the output.
- **No stylesheet padding.** Tailwind's automatic source detection reads the whole
  project, so before `assets/tailwind.css` pinned its sources the shipped CSS
  carried ~1.9 kB of rules built from _prose_ in specs and docs — `.container`
  from the word "container", `.shadow` from "shadow DOM". The spec now asserts
  every styled class appears somewhere in `entrypoints/`.
- **`.gitignore` really covers the output and env files**, asserted through
  `git check-ignore` rather than by reading the file (build guide rule 4: never
  commit a key, a `.env`, or anything built).

## Known platform limits (Phase 16 verification)

### Chrome only

The review panel is a Chrome side panel (`chrome.sidePanel`), which Firefox does
not implement — it has `sidebarAction` instead. The `dev:firefox` and
`build:firefox` scripts come from WXT and are left in place, but nothing in this
project has been verified against Firefox and the panel will not open there.

### Cross-origin forms

Careers pages routinely serve the page from one origin and the application form
from another, inside an iframe. `test-fixtures/cross-origin-parent.html`
reproduces that shape: served from `localhost`, its iframe points at `127.0.0.1`
on the same fixture server — same bytes, genuinely different origin, so the
browser applies real cross-origin rules. `test/e2e/cross-origin.spec.ts` drives it
against the built extension.

Fields inside a **same-origin** iframe are read normally (asserted in
`test/e2e/field-detector.spec.ts` against `iframe-parent.html`).

**What was observed.** Two manifest entries decide different things, and they turn
out to be separable:

| Build                                                                        | `executeScript({ allFrames: true })` sees the child frame | A scan addressed at the child frame                                       |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| Shipped — `matches: ['<all_urls>']`, `host_permissions: ['<all_urls>']`      | yes, as its own frame id                                  | answers with `Child Email`, in a job context whose URL is the child's own |
| `host_permissions` narrowed to `['http://localhost/*']`, `matches` unchanged | no — the top frame only                                   | still answers: the content script's own `matches` is what grants it       |
| Both narrowed to `['http://localhost/*']`                                    | no — the top frame only                                   | `Could not establish connection. Receiving end does not exist.`           |

So **detection follows the content script's `matches`**, while
**`host_permissions` decides whether the extension can discover or inject into a
frame at all**. In all three builds the top frame scanned normally, the page and
the embedded form stayed fully usable by hand, and nothing threw: the failure mode
for an uncovered frame is that its fields are not listed — not a crash, and not an
error state in the panel.

**The limit that applies to the shipped build.** The side panel scans frame 0 only
(`MAIN_FRAME` in `entrypoints/sidepanel/App.tsx`), so fields inside _any_ iframe —
cross-origin or not — are never listed for review, even though the content script
can read them. Aggregating frames would mean enumerating them with
`chrome.scripting.executeScript({ allFrames: true })` and merging the results with
each field tagged by frame; that is out of scope for the MVP. Until then, the
workaround for an embedded form is to open the form's own URL in its own tab (most
ATS forms have one) and scan there.

**Reproducing the narrowed rows.** The default `npm run test:e2e` run covers the
shipped build; the other two rows need a hand-built variant:

```bash
# row 2: in wxt.config.ts, set host_permissions to ['http://localhost/*']
npm run build && JAC_NARROWED=permissions npm run test:e2e -- cross-origin

# row 3: also set matches to ['http://localhost/*'] in entrypoints/content.ts
npm run build && JAC_NARROWED=both npm run test:e2e -- cross-origin

# then put the manifest back
git checkout -- wxt.config.ts entrypoints/content.ts && npm run build
```

## Non-goals

- **No auto-submit.** The extension never submits a form on your behalf.
- **No bulk / mass application.** One page, one review, one insert at a time.
- **No stored resume file.** A CV you import is sent to the Gemini API to be read once and is not kept by the extension; resume variant entries store a file reference only, and no file is ever attached to a form for you.
- **No auto-filled profile.** Imported data is a proposal until you tick and confirm it — see [Importing a CV](#importing-a-cv).

## Real-world validation log (Phase 17)

Full results: **[docs/manual-validation.md](docs/manual-validation.md)**. Run on
2026-08-21 against five live pages — Greenhouse, Lever, Ashby, a Phenom-based
company careers site, and Workday as the worst case — with the production build
and no API key.

| Site                               | Fields detected | Labels reasonable           | Drafts usable      | Insert works           | Nothing submitted |
| ---------------------------------- | --------------- | --------------------------- | ------------------ | ---------------------- | ----------------- |
| Greenhouse (posting + inline form) | 19–20           | yes, all structured         | needs your API key | yes (one loss, see F3) | yes               |
| Lever (`/apply` route)             | 55              | yes, all structured         | needs your API key | yes                    | yes               |
| Ashby (`/application` route)       | 35              | yes, incl. all three essays | needs your API key | yes                    | yes               |
| Netflix careers (Phenom)           | 8               | consent widgets only (F1)   | needs your API key | yes                    | yes               |
| NVIDIA Workday (form behind login) | 1               | yes (the job search box)    | needs your API key | yes                    | yes               |

The objective half is automated in
[test/e2e/real-pages.spec.ts](test/e2e/real-pages.spec.ts) and re-runnable:

```bash
npm run build
JAC_REAL_PAGES=1 npm run test:e2e -- real-pages
```

It is skipped by default: it needs the public internet, and live postings close.

The whole run was repeated from a fresh clone for Phase 18 — `npm install && npm run build`, then the full suite at **47 passed, 2 skipped** against all five sites — which is the evidence behind the setup instructions above. Details, including the two findings it corroborated, are in the log.

**What real pages showed that fixtures could not.** Consent dialogs and search
boxes are detected as application fields, because structurally they are labelled
inputs and the detector has no notion of "not part of an application" (F1). A scan
is a snapshot — the same Greenhouse form reported 17, 19, and 20 fields seconds
apart while it mounted, and two sites returned _zero_ fields when scanned at
`domcontentloaded` and full sets a few seconds later, so rescanning matters (F2).
An insert can be accepted and then discarded by the site's own later re-render,
which is why you should read a form before submitting it (F3). Draft quality is
the one checklist item automation cannot settle; the steps and an empty table for
it are in the log.

## Project structure

```text
entrypoints/
  background.ts          # Service worker: message handlers
  content.ts             # Content script: scan + insert
  options/App.tsx         # Profile & settings editor
  sidepanel/App.tsx       # Review panel
lib/
  types.ts               # Shared data contracts (DetectedField, ProfileData, …)
  storage.ts             # Local-only profile + settings persistence (WXT storage)
  field-detector.ts      # DOM scanner (label resolution, shadow DOM, iframes)
  job-context.ts         # Page text extraction + role-family synonym map
  messaging.ts           # Typed message contracts (@webext-core/messaging)
  retrieval.ts           # BM25-style fragment retrieval from profile
  gemini-client.ts       # Shared Gemini transport (URL, key header, error mapping)
  generator/
    types.ts             # Generator interface + GeneratorError
    gemini-generator.ts  # Gemini API implementation
    mock-generator.ts    # Deterministic stub for tests and dev
  extractor/
    types.ts             # ProfileExtractor interface + PDF size limit
    schema.ts            # Strict zod schema; rejects fields a CV may not fill
    gemini-extractor.ts  # Inline-PDF extraction request
    mock-extractor.ts    # Canned CV for tests and dev
    merge.ts             # Review model: build items, edit them, apply the ticked ones
    upload.ts            # File → base64, and what counts as a usable PDF
  prompt-builder.ts      # Batched prompt assembly
  schema-validator.ts    # GeneratedAnswer[] shape validation
  orchestrator.ts        # Retrieve → prompt → generate → validate pipeline
  cache.ts               # Answer cache with profile-hash invalidation
  mapping-cache.ts       # Per-site learned label corrections
  insert-handler.ts      # Native-setter insertion (React-compatible)
test/
  unit/                  # Vitest specs (313 tests)
  e2e/                   # Playwright specs (real browser, built extension)
test-fixtures/           # Static HTML pages served for E2E tests
docs/
  manual-validation.md   # Phase 17 real-world validation log
```
