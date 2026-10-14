# AI review: history, usage, and settings pages (Phase 9 step 9d)

Date: 2026-10-14
Base commit: `df2acef` (feat: add the ask screen with answers, charts, and every result state)

## What changed

All changes are in `apps/web` and the docs. The API is unchanged.

- **History, `/history`:**
  - entries newest first, 20 at a time with the API's cursor ("Load older");
  - for each entry: the question or SQL, its status, connection, time, rows, duration, a saved-query badge, the summary or explanation, and the error code;
  - **Run again** replays the stored SQL (`POST /v1/history/:id/rerun`) and shows the fresh rows in place;
  - **Ask again** opens `/ask` with the connection and question filled in;
  - **Delete** removes one entry; **Clear all** asks for confirmation first.
- **Usage, `/usage`:** today's questions against the limit (a progress bar that turns orange at 80% and red at 100%), questions finished, rows returned, AI tokens, the per-minute limit, and the reset at midnight UTC.
- **Settings, `/settings`:**
  - name, email, avatar, plan, and sign out;
  - **delete account** after typing "delete", listing what is removed. The security log keeps the account's id, not its name or email; this was checked in `auth.service.ts`.
- **Ask page:**
  - reads `?q=` to fill in the question;
  - refreshes history and usage when a job ends.
- **Menu:** Ask, History, Connections, Usage, Settings.
- **Docs:** implementation (step 9d), features, and the README.

## AI usage

An AI assistant (Claude Code) built the pages from the API contracts, and checked the account-deletion and usage wording against the server code.

## Suggestions accepted

- **Re-run results shown in place** under the entry, so the user keeps their place in the list.
- **A typed confirmation for deleting the account**, because it cannot be undone.

## Decisions

- **"Questions finished", not "Questions answered".** The server's `finishedQuestions` counts every finished question job, ambiguous and failed included. Caught while reviewing the first draft.
- **Clearing history does not reset usage.** Usage has its own table (ADR 0013), and the confirmation says so.

## Problems found during this change

1. **The first usage label overstated the count** (see Decisions). Fixed before commit.
2. **The first delete-account wording said the log keeps no identifying data.** It keeps the account's id. The wording was made exact.

## What was checked

- **Web unit tests:** 68 (10 new).
  - **History:** the list and older pages; empty history; run again; the "Ask again" link; delete one and clear all.
  - **Usage:** the count, what's left, and the totals; the limit reached.
  - **Settings:** the profile and sign out; deletion only after "delete" is typed; a failed deletion keeps the user signed in.
- **Manual check through the Vite dev server**, with the real API, worker, and sample database (SQL only, so no model calls):
  - history listed the run query and the refused `DELETE` (`SQL_REJECTED`);
  - run again returned fresh rows and became a new entry;
  - usage showed 0 of 50 questions, because SQL does not count;
  - delete one and clear all both worked;
  - after deleting the account, the old token gave 401.
- **Other checks:**
  - `tsc`, `vite build`, ESLint (the one known warning), and Prettier pass;
  - the other workspaces are unchanged and were not run again.

## Still open

- **To finish Phase 9:** Playwright tests of the demo flow, a check at phone and desktop widths, and an accessibility pass.
- **Editing a saved connection's address or login** is still not in the app.
- **The main bundle is about 680 kB before compression.** Route-level splitting is still to do.
