# AI review: query history, and keeping row values out of summaries (Phase 8 step 8a)

Date: 2026-10-14
Base commit: `6d3269d` (feat: use a lighter model for summaries)

## What changed

**Query history (ADR 0013).**

- **Table:** `queries` (migration `20261014150000_query_history`, generated with `prisma migrate diff`). One row per finished question or SQL job, keyed by the job id.
  - **What it keeps:** the question, the SQL that ran, the status, the error code, row count, truncation, schema version, whether the answer was cached, the summary, the models, tokens, and timings.
  - **What it never keeps:** result rows.
  - **Indexing and deletion:** indexed for keyset paging; cascades with the user and with the connection.
- **Core:**
  - `QueryHistory` and `PrismaQueryHistory` (record as an upsert, keyset list, get, delete, delete all);
  - `historyEntryFor`, which builds an entry from the outcome the owner saw;
  - cursor encode and decode;
  - `HistoryModule`.
- **Worker:**
  - `JobProcessor.finish` records each finished question or SQL job, including cancellations, and `recordGivenUp` records jobs that crashed on their last attempt.
  - A failed write goes to `onSideError` and never fails the job.
  - The processor's history dependency is optional, so tests of other behaviour do not need storage.
- **API, `apps/api/src/history`:**
  - `GET /v1/history?limit&cursor` returns 20 by default and 50 at most, newest first.
  - `GET /v1/history/:id` returns one entry.
  - `POST /v1/history/:id/rerun` replays the stored SQL as a `query.run` job (the user's choice: no model call, and the guard checks it again).
  - `DELETE /v1/history/:id` and `DELETE /v1/history`.
  - All are owner-only; anything else is NOT_FOUND.

**Privacy fix (a defect from step 7.4).**

- **The defect:** `computeFacts` put labelled top items, which are row values, into the facts even when the connection did not allow rows. The facts go to the summary model and feed the template, and the template text is stored in history.
- **The fix:** `computeFacts(result, { labels })` now includes them only when `sendSampleRowsToLlm` is on.

**Docs:** ADR 0013 (new), ADR 0012 (facts), features (history, account deletion, summary inputs), implementation (Phase 8 section), and the README ("History").

## AI usage

An AI assistant (Claude Code) designed history and wrote the code and tests. It explained the label leak found by its own test, and fixed it the way the user chose.

## Suggestions accepted

- **The user's choices:** 50 questions a day and 10 submissions a minute (both for 8b), re-run replays the stored SQL, and labels are stripped everywhere when rows are not allowed.
- **Keyset pagination**, as the blueprint asks, with time and id as the tie-breaker.
- **Recording from the worker, at the moment a job finishes**, so history matches what the owner saw, including cancellations and give-ups.

## Suggestions rejected

- **Offset pagination.** It slows down as history grows, and pages shift when new entries arrive.
- **Keeping history after a connection is deleted.** The entries could not be re-run, and they describe a database the user removed.
- **Stripping labels from the model only.** The template would still have written a row value into history (the user chose to strip them everywhere).

## Decisions

- **The summary is stored in history**, because blueprint 8.4 shows it. With rows not allowed it now holds only names and numeric totals.
- **The history record uses `upsert`**, so a retried job writes one entry.
- **A `queries` row's `created_at` is the job's creation time**, and `finished_at` is when it was recorded.

## Problems found during this change

1. **The label leak** (above). It was found by the new question-job integration test, which checks that the stored entry holds no row value.
2. **A test assertion was too broad.** It checked that the whole job result had no row values, but the owner is meant to get their rows back. It was narrowed to the summary and the facts.

## What was checked

- **Unit tests:** core 283.
  - **New for history:** entry mapping for answered, ambiguous, failed, cancelled, and SQL jobs; none for connection jobs; cursors; processor recording, a failed write, and a give-up.
  - **New for privacy:** labels left out of facts, the template, and the prompt; and the summary may name values when rows are allowed.
- **API tests:** 85, of which 6 are new HTTP tests: list with cursor and clamped size, one entry, 404 for someone else's, re-run of stored SQL, 404 with nothing to re-run, and deletes.
- **Integration tests:** 87.
  - **5 new for history:** paging across 3 pages without gaps or repeats, including a tie on time; owner-only access; a retried job written as one entry; no column for result rows; deleting one, then all; account deletion.
  - **The question-job test** now checks that history was written, with no row values.
- **Other checks:** end-to-end 3, worker 5, and guard 310 pass. ESLint, Prettier, the build, and the migration pass.

## Still open

- **Step 8b:** the daily quota (50), the per-minute limit (10), login rate limits, `GET /v1/usage`, and audit entries for rejected SQL and history deletions.
