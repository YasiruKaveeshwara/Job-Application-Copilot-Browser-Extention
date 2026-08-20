# Job Application Copilot

A browser extension (Manifest V3) that detects fields on job-application pages and
drafts answers from your own profile using the Google Gemini API
(bring-your-own-key). It never auto-submits and never bulk-applies — you review,
edit, and insert every answer yourself.

> Status: early build, following `AI-AGENT-BUILD-GUIDE.md` phase by phase.

## Tech stack

- **[WXT](https://wxt.dev)** — MV3 extension framework (Vite + TypeScript)
- **React + Tailwind CSS** — options page and side panel UI
- **[@webext-core/messaging](https://webext-core.aklinker1.io/messaging/)** — typed message contracts
- **Vitest** — unit tests · **Playwright** — E2E tests

## Development

```bash
npm install          # installs deps and runs `wxt prepare`
npm run dev          # start the dev server + load the unpacked extension
npm run build        # production build into .output/
npm run typecheck    # wxt prepare && tsc --noEmit
npm run lint         # eslint
npm run test         # vitest (unit)
npm run test:e2e     # playwright (e2e)
```

Load the unpacked extension from `.output/chrome-mv3/` via `chrome://extensions`
(developer mode on) when not using the dev server.

### Reviewing the panel without an API key

`VITE_USE_MOCK_GENERATOR=true` swaps the real generator for a canned one, so the
whole scan → draft → review round trip runs with no key and no spend:

```bash
VITE_USE_MOCK_GENERATOR=true npm run dev
```

Then open `test-fixtures/standard-labels.html` (served by
`node test/e2e/static-server.mjs` on `http://localhost:3999`), click the toolbar
button to open the side panel, and press **Scan this page**.

## API key

The Gemini API key is entered in the extension's options page and stored in
local extension storage only. **Never commit an API key or a `.env` file** —
both are git-ignored.

## Non-goals

- No auto-submit of any form.
- No bulk / mass application.
