# AI review: a silence limit for followed jobs (fix after Phase 9 step 9b)

Date: 2026-10-14
Base commit: `01a1618` (feat: add the connect wizard and the allowlist editor)

## What changed

- **`watchJob` in `apps/web/src/api/jobs.ts`:** a stream that sends nothing for `idleMs` (45 seconds by default) is dropped and reconnected.
  - **What counts as data:** any chunk, including the API's keep-alive every 15 seconds.
  - **How it drops the stream:** each attempt has its own `AbortController`, linked to the caller's signal. On silence, the attempt is aborted and its reader cancelled, and the existing reconnect-then-poll logic carries on.
  - **Leaving the page** still stops everything.
- **Tests:**
  - a stream that sends one event and then goes silent without closing is dropped, and the reconnect gets the final state;
  - a quiet stream that keeps sending keep-alives is kept;
  - an existing assertion now expects an `AbortSignal`.
- **Docs:** ADR 0014 (following jobs) and implementation (Phase 9).

## AI usage

An AI assistant (Claude Code) investigated the user's report of an endless "Saving the connection" spinner, explained the cause, and made the fix the user chose.

## Problems found during this change

1. **The user's connection failed for an ordinary reason:** port 5432, the form's default, instead of the sample database's 5433. The job failed in 0.39 s with `CONNECTION_FAILED`.
2. **The app never showed the failure.** The investigation, step by step:
   - The job record in Redis showed it had finished.
   - The API process had restarted 3 seconds later, and did so again after a reproduction.
   - An experiment showed `node --watch` restarts on file changes, never on crashes.
   - A file watcher on the repo caught a test run rebuilding `ssrf-guard`, `crypto`, and `sql-guard` and running `prisma generate`. The running API and worker load those files, so they restarted.
   - Through the Vite proxy, the browser's stream stayed open with nothing arriving, and `watchJob` had no time limit.
3. **The user first suspected OneDrive sync;** it was paused, which ruled it out.
4. **An orphaned `npm run test:int` from the assistant's own session at 09:44** had been hanging for about 5.5 hours. It was identified by its parent process (Git Bash, the assistant's shell) and stopped. The user's own run, started at 15:08 from a Cursor terminal, was left alone.
5. **Shell escaping turned `\n` into real line breaks** in two new tests. Fixed with exact edits before committing.

## Decisions

- **45 seconds:** three missed keep-alives. Shorter would risk dropping a healthy stream on a slow network; longer would leave the user waiting.
- **Rebuilds are not prevented in development.** Restarting on changed code is the point of watch mode. The README already says to start the servers after builds; the user now knows to let a test run finish before clicking through the app.

## What was checked

- **Web unit tests:** 41 (2 new).
- **The new silence test fails without the fix:** with the limit set out of reach, it timed out after 5 seconds, as the spinner did. It passes with the fix.
- **Other checks:** `tsc`, `vite build`, ESLint, and Prettier pass.
- **The other workspaces were not changed** and were not run again.

## Still open

- **Running a test suite while using the app locally still restarts the API and worker.** That's expected in watch mode, and now harmless to a followed job, which reconnects.
