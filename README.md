# Job Application Copilot

A browser extension (Manifest V3) that detects fields on job-application pages and
drafts answers from your own profile using the Anthropic Messages API
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

## API key

The Anthropic API key is entered in the extension's options page and stored in
local extension storage only. **Never commit an API key or a `.env` file** —
both are git-ignored.

## Non-goals

- No auto-submit of any form.
- No bulk / mass application.
