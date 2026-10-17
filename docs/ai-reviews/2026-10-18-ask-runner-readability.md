# AI review: make the question runner and the job stream easier to read

Date: 2026-10-18
Base commit: `a05a395` (docs: say what each file is for, fix stale comments, and name magic numbers)

## What changed

This is commit 2 of 4 in the readability cleanup. The behaviour is meant to be the same; only the shape of the code changed.

- **`AskJobRunner.answer()` (`packages/core/src/ask/ask-job.runner.ts`).** It was one 170-line loop. Its five counters and flags changed through `continue` statements in three places. Now each loop tries one proposal in four numbered steps:
  1. `nextProposal()`: the cached proposal the first time round, otherwise the model.
  2. The guard check. On a rejection, `onGuardRejected()` decides whether to retry or give up.
  3. Running the SQL. On a failure, `onQueryFailed()` decides whether to retry, report the schema change, or give up.
  4. `buildAnswer()`: cache the proposal, compute facts, pick the chart, and write the summary.

  The retry state is one typed `RetryState` object (`cached`, `feedback`, `guardRetries`, `queryRetried`). Each helper returns either `'retry'` or the final `Pass`. Ambiguous and unanswerable results are built in `notAnswerable()`.

- **`jobs/job-errors.ts` (new).** It holds the three ways an expected failure becomes the owner's `JobError`:
  - `fromException`, moved from `query-job.runner.ts`, where two other runners imported it from;
  - `llmFailure`, moved from `ask-job.runner.ts`;
  - `executionFailure`, new. It replaces two copies of the same object literal.
- **`jobs/run-checked-sql.ts` (new).** `runCheckedSql()` runs the sequence both SQL-running jobs repeated: stop if cancelled, report `connecting`, resolve the connection, stop if cancelled, report `running_query`, run. It returns `{ ran: true, connection, result }`, or `{ ran: false, error }` when the database could not be reached.
- **`QueryJobRunner`** now uses `runCheckedSql` and `executionFailure`.
- **`AskResult` (`job.types.ts`).** The seven fields every status shares are one `AskCommon` type. Before, each of the three variants listed them out with their doc comments. The resulting type is the same.
- **`attemptsOf()`** from `llm-client.ts` now reads a failed call's attempts in `summarize()` and `propose()`. Before, each `catch` did it by hand with a cast.
- **`streamJob` (`apps/api/src/jobs/job-stream.ts`).**
  - Numbered comments mark its six steps: read, open, first send, subscribe, re-read to close the race, and timers.
  - New comments explain why `closed` is checked after every `await`.
  - The 10-minute deadline is now `setTimeout`. It was `setInterval`, which only ever fired once before `close()` cleared it. `clearInterval` clears both kinds of timer in Node.

## AI usage

An AI assistant (Claude Code) did the following:

- found the long function and the duplicated sequences in a read-only audit;
- proposed the split, which the user approved as part of the plan;
- wrote the new code by hand. It checked each branch of the old loop against the new helpers. For example: a cached proposal that fails as `QUERY_INVALID` is forgotten, then retried with the model without using the one query retry; the final executor failure has the same `{ code, message, retryable }` and no `detail`.

## Suggestions accepted

- Named steps with a typed retry state, instead of a state machine library or a class per step.
- One helper for "resolve and run", shared by both SQL jobs.

## Suggestions rejected

- **Changing `SqlRun` to `{ ok }`** like the other results. `ok: true` would sit next to a failed query result, which reads wrongly, so it uses `ran`. Result shapes in general are a known inconsistency (to be listed in `docs/conventions.md`), not changed here.
- **Moving `failed()` into `job-errors.ts`.** Only the question runner uses it.

## Decisions

- **`runCheckedSql` takes its dependencies as an object** (`{ connections, executor }`) rather than the runner itself. The runners' fields are `private`, and a plain object also makes the inputs obvious.

## Problems found

- None in behaviour. The first draft passed `this` as the dependencies. That would not compile, because the fields are private, and it was fixed before building.

## What was checked

- **Build:** `npm run build` passes.
- **Unit tests:** core 293 of 293, API 112 of 112, and worker 6 of 6.
  - `ask-job.runner.spec.ts` (698 lines) covers every retry path: cache hit, cached proposal rejected by the guard, two guard rewrites, the one query rewrite, schema-changed refresh, cancellation, and model failures.
  - `job-stream.http.spec.ts` covers the stream, its heartbeat, and its deadline.
  - No test needed changing.
- **Lint and Prettier:** pass on `packages/core/src` and `apps/api/src`.
- **Not run yet:** `test:int` and the browser tests, because Docker Desktop was not running. They are planned after the web commit, and they cover this commit too (`query-jobs`, `question-jobs`, and `job-lifecycle` run the real executor against PostgreSQL).

## Still open

- Run `npm run test:int` and `npm run test:browser` once Docker is up.
