# Real-world validation log (Phase 17)

What the extension does on application pages written by people who have never
heard of it. Fixtures can only confirm the detector does what it was built to do;
this is the record of what happened against live sites.

**Run on** 2026-08-21, against the unpacked production build (`npm run build`) at
commit `2dbe85b`, no API key configured. Playwright 1.62.1 / bundled Chromium,
Node 24.17.

Everything objective here is automated in
[test/e2e/real-pages.spec.ts](../test/e2e/real-pages.spec.ts) and re-runnable:

```bash
npm run build
JAC_REAL_PAGES=1 npm run test:e2e -- real-pages

# other pages (postings close; this is the intended way to swap them):
JAC_REAL_PAGES=1 JAC_REAL_PAGE_URLS="https://…,https://…" npm run test:e2e -- real-pages
```

It is skipped without `JAC_REAL_PAGES=1`: it needs the public internet, and a
suite that goes red because a company filled a role is a suite people learn to
ignore. It prints a report per page, and the report is what fills in this file.

## Sites visited

Deliberately varied, as the phase asks: two major ATSes, a modern React ATS, a
large company's own careers site, and a worst case.

| #   | Site                                                | What it is                                              | Fields detected                                                      | Labels                                                          | Job context                                                   | Insert                                                | Submitted anything |
| --- | --------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- | ------------------ |
| 1   | `job-boards.greenhouse.io` — Engineering Manager    | Major ATS, form inline on the posting                   | 19–20, immediately                                                   | all `structured`, and they are the questions on the page        | 10.3 k chars, starts at the posting body                      | `First Name*` accepted and held (once discarded — F3) | no                 |
| 2   | `jobs.lever.co/palantir/…/apply`                    | Second major ATS, form on its own route                 | 55, after 1 s                                                        | all `structured`, incl. 30+ language checkboxes                 | 12 k chars — the budget cap, so the posting body is truncated | `Full name✱` accepted and held                        | no                 |
| 3   | `jobs.ashbyhq.com/ashby/…/application`              | Modern React ATS, form on its own route                 | 35, after 2–3 s                                                      | 33 `structured` incl. all three essay questions, 2 by proximity | 3.7 k chars, clean posting body                               | `Name` accepted and held                              | no                 |
| 4   | `explore.jobs.netflix.net/careers/job/790298014263` | A company's own careers site (Phenom), not a board      | 8 — **all cookie-consent widgets**; the page has no application form | correct for what they are, useless as application fields        | 7.1 k chars, site chrome first, then the posting              | `Cookie list search` accepted and held                | no                 |
| 5   | `nvidia.wd5.myworkdayjobs.com/…` — Workday          | Worst case: heavy client rendering, form behind a login | 1, after 6–8 s (the job search box)                                  | `structured` (`Search`)                                         | 2.4 k chars of the listing page                               | `Search` accepted and held                            | no                 |

## The phase's checklist, item by item

| Checklist item                                                               | Status                                                       |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Trigger scan, fields detected and labels reasonable                          | **pass**, with F1 and F2 below                               |
| Job context extraction produces sensible text                                | **pass**, with F4 below                                      |
| Generated answers relevant and usable as drafts, not just schema-valid       | **not done — needs an API key.** See "Left for the user"     |
| Correct a misclassified field, remembered on a second visit to the same site | **pass** — automated against site 1                          |
| Insert updates the site's own form state, not overwritten or rejected        | **pass** on all five sites; F3 records one intermittent loss |
| Nothing submitted without clicking the site's own submit button              | **pass** — no navigation on any insert, on any of the five   |

The correction round trip is the shipped panel end to end on a real domain:
scan site 1, correct the misclassified `Search` field to
`not-an-application-question`, panel confirms "Saved for
job-boards.greenhouse.io", then reload, rescan, and the mapping is still stored
under that host — which is what the next generation reads as a hint. The
per-host keying (one origin's corrections never becoming another's) is covered
by [test/e2e/field-correction.spec.ts](../test/e2e/field-correction.spec.ts).

## Re-run from a fresh clone (Phase 18)

Phase 18's acceptance is that a fresh clone with only an API key added works end
to end, so the whole thing was done again from one: `git clone` into an empty
directory at commit `9f9c340`, then `npm install && npm run build`, then
`JAC_REAL_PAGES=1 npx playwright test` — **47 passed, 2 skipped** (the two skips
are the narrowed-manifest cross-origin variants, which need a hand-edited build;
see the README). The clone's build is byte-identical to this repo's, install and
build leave the tree clean, and nothing the build needs is git-ignored.

Same five sites, second independent run, with no API key again:

| Site               | Fields (first run → this run) | Insert read back            |
| ------------------ | ----------------------------- | --------------------------- |
| 1 Greenhouse       | 19–20 → 17, then 19, then 20  | **held** this time          |
| 2 Lever            | 55 → 55                       | held                        |
| 3 Ashby            | 35 → 35 (after 4 s)           | held                        |
| 4 Netflix (Phenom) | 8 → 8                         | held (`Cookie list search`) |
| 5 NVIDIA Workday   | 1 → 1 (after 7 s)             | held                        |

Every count is the same as the first run, and the two slow pages were slow again
by about the same margin — the numbers in this table are the ones the spec's
per-page report printed, so anything it did not print is left out rather than
guessed at.

Two findings below get stronger evidence from this run rather than weaker. **F2**:
the Greenhouse form reported 17, 19, and 20 fields at three different moments
_within the same run_, which is the snapshot problem in one page. **F3**: the
Greenhouse insert was read back intact this time — the earlier loss was a slow
load re-mounting the form, not a defect that reproduces, which is exactly why it
is written up as something to watch for rather than a bug to fix. The correction
round trip stored the same mapping again.

Draft quality is still the open item, and still needs a key.

## What didn't work

**F1 — Consent and cookie UI is detected as application fields.** Site 4's eight
"fields" are entirely its cookie dialog (`Performance and Functionality
Cookies`, `Cookie list search`, four `checkbox label` checkboxes, and a textarea
labelled by proximity from `Save settings`). Site 1 offers the search box inside
its country combobox; site 5 offers the job search box. Structurally these are
labelled inputs in the document, and the detector has no notion of "this is not
part of an application", so they become cards to review and questions to draft
answers for. Impact: junk cards and wasted tokens, not wrong answers. Workaround:
ignore the cards; the correction control also lets you mark one, per site. A
noise filter (consent-dialog containers, `role="dialog"` ancestors, search
landmarks) is the obvious next improvement and is not in the MVP.

**F2 — A scan is a snapshot, and real forms move.** The same Greenhouse posting
reported 17, 19, and 20 fields on different scans seconds apart, as the form
finished mounting. Nothing is wrong with any individual scan; the count is just
whatever existed at that instant. Impact: a scan fired too early under-reports.
Workaround: press Rescan once the form has visibly finished rendering. The spec
polls for up to 30 s for this reason — sites 3 and 5 returned **zero** fields on
a scan fired at `domcontentloaded` and full field sets 2–8 s later, so "0 fields"
on a real page usually means "too early", not "undetectable".

**F3 — An insert can be discarded by a re-render afterwards.** Once, on site 1,
`INSERT_FIELD` reported success — the handler confirms the field holds the text
before returning, see [lib/insert-handler.ts](../lib/insert-handler.ts) — and a
read-back from outside the extension moments later found the input empty. The
page had taken 30 s to load that run and was still re-mounting its form; the
write landed on a node the site then replaced. Not reproducible on demand, and
nothing the extension can do about it: it cannot keep re-writing a field the user
did not ask it to. Impact: an answer you believe you inserted may not be there.
Workaround, and the reason the panel never submits anything: read the form before
you submit it.

**F4 — Job context starts with site chrome, and hits the budget cap.** Site 4's
extracted text opens with `Skip to main content CAREERS LOCATIONS ONLY AT
NETFLIX…` before reaching the posting, and on one run site 2's opened with its
cookie notice (`🍪 denyaccept Privacy Notice…`). Site 2 also hits the 12 000-char
`PAGE_TEXT_BUDGET` exactly, so the tail of that posting is cut. Impact:
retrieval and the prompt see less signal per token than they could. The role
family is still identified correctly (the page title carries it), so this
degrades draft quality rather than breaking it.

**F5 — Fields inside iframes are still not offered** (the Phase 16 limit; see the
README). Visible here as third-party frames that answer scans with their own
fields: site 2's hCaptcha frames report two unlabelled textareas each, and one
reports a `role:listbox` labelled `EN`. They stay out of the review list only
because the panel scans frame 0 — i.e. today the limitation is also what keeps
captcha internals off your screen. Anything that aggregates frames later needs
F1's noise filter first.

**F6 — Two of the five real application forms could not be reached logged out.**
Site 5 keeps its form behind a Workday login, and site 4's `APPLY NOW` leads out
of the posting page. This is the "worst case" the phase asks for, and the honest
result is that on those two sites the extension finds a search box and nothing to
draft.

## Left for the user (needs a Gemini API key)

### Draft quality

Draft quality is the one checklist item no automation settles: whether a
paragraph is a usable first draft is a judgement about your own history, and
`VITE_USE_MOCK_GENERATOR` produces deterministic stub text on purpose. A plain
`npm run build` has no generator wired to a key, so drafts require yours.

1. Load `.output/chrome-mv3/` unpacked, open **Options**, paste your Gemini API
   key, and fill in the profile (work history, projects, standard answers).
2. Open site 3 above, or any live posting whose form is on the page — sites 1–3
   are the ones with real questions to answer.
3. Open the side panel, press **Scan this page**, and wait for drafts.
4. Read them against the checklist item: relevant to _this_ posting, grounded in
   your profile rather than invented, usable as a first draft with editing.
5. Insert one, check it in the site's own form, and record what you found in the
   table below.

| Site | Model | Drafts relevant to the posting | Grounded in the profile | Usable as first drafts | Notes |
| ---- | ----- | ------------------------------ | ----------------------- | ---------------------- | ----- |
|      |       |                                |                         |                        |       |

Worth watching while you do: whether F1's junk cards (cookie widgets, search
boxes) get drafts generated for them, and how much of the answer budget they
consume.

### CV import, against two real CVs

Same reason: a real CV is the only thing that shows whether the model reads a
_layout_ — two columns, a sidebar of skills, dates in a gutter — rather than
whether the request is well formed, which `test/unit/gemini-extractor.test.ts`
already settles. The suite deliberately ships no CV: a real one is someone's
personal data and does not belong in a repository.

Two runs, because the second is the one that can go wrong quietly:

1. Load `.output/chrome-mv3/` unpacked, open **Options**, paste your key.
2. **First CV, empty profile.** Upload it under **Import from a CV**. Check
   that every item is grouped under the right category, that nothing was
   invented (each value traceable to a line in the document), and that every
   item is marked **New** and ticked. Untick one, edit another, discard a third,
   then **Confirm** — and check that exactly the ticked items landed in the form
   above, with your edit and without the discarded one.
3. **Second CV, over a section you filled in by hand.** Type something into
   Personal and into one work-history entry, save, then upload the second CV.
   Everything that would touch what you typed must appear as **Proposed change**
   and be **unticked**, showing your value beside the CV's. Confirm with those
   left unticked and check your text is still there afterwards.
4. Re-upload the same CV once more: the review should come back empty
   ("Nothing new"), not a duplicated profile.
5. Check the five exclusions are untouched — no project got an
   individual/group answer you did not pick, and `narrativeFragments`,
   `standardAnswers`, `stylePreferences`, and `resumeVariants` are as you left
   them.

| CV                     | Categories correct | Nothing invented | Overwrite shown as a proposal | Re-import empty | Exclusions untouched | Notes |
| ---------------------- | ------------------ | ---------------- | ----------------------------- | --------------- | -------------------- | ----- |
| 1 (into empty profile) |                    |                  | n/a                           |                 |                      |       |
| 2 (over manual entry)  |                    |                  |                               |                 |                      |       |

The mock extractor covers the mechanics of the review screen without a key —
`VITE_USE_MOCK_GENERATOR=true npm run dev`, then upload any PDF — which is worth
doing first to learn the screen before spending a request on it.
