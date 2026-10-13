# AI review: queue, job status, and query jobs (Phase 6 step 3a)

Date: 2026-10-13
Base commit: `8d78a72` (refactor: move shared infrastructure into packages/core)

## What changed

Queries now run as worker jobs (ADR 0011).

**New endpoints:**

- `POST /v1/connections/:id/queries {sql}` checks the caller owns the connection and that `sql` is a non-empty string within the guard's 20,000-character limit. It queues a `query.run` job and answers **202** with the job.
- `GET /v1/jobs/:id` shows the owner the job's state: `queued`, `running`, `succeeded` with the result, or `failed` with an error. Anyone else, a malformed id, or an expired job gets 404.

**In `@ayd/core`:**

- `JobQueue` adds and reads jobs. It uses BullMQ 6 with UUID job ids, and finished jobs are removed after `JOB_RESULT_TTL_SECONDS`.
- `QueryJobRunner` runs guard, then resolve target, then executor, and returns an outcome.
- `JobProcessor` dispatches by kind.
- `JobQueueModule` is for the API; `JobRunnersModule` is for the worker.
- New settings: `JOB_QUEUE_NAME` and `JOB_RESULT_TTL_SECONDS`, plus the crypto keys and `SSRF_ALLOW_PRIVATE`. The production check for `SSRF_ALLOW_PRIVATE` moved into core's `checkCoreEnv`.

**Moved from the API to core**, because a query job needs them in the worker:

- `ConnectionService`, `SchemaService`, and `SqlGuardService`, with their repositories.
- `allowed-schema`, `allowlist-input`, `sensitive-columns`, `AppException`, and `writeAuditLog`.
- New `ConnectionsCoreModule`, `SchemaCoreModule`, and `SqlGuardCoreModule`.
- The API modules are now controllers plus auth over those modules.
- The in-memory fakes moved to `packages/core/src/testing`. API tests import them as `@ayd/core/testing`, mapped in the API's Jest configs and `tsconfig.json`.

**Worker:**

- `JobWorker` takes jobs (`WORKER_CONCURRENCY`, default 5), hands them to `JobProcessor`, and logs each finished job's id, kind, outcome code, and duration. It closes cleanly on shutdown.
- Compose gives the worker the crypto keys and `SSRF_ALLOW_PRIVATE`, and runs it as `development`, like the API.

**Shared:** the new error code `SQL_REJECTED`.

**Docs:** ADR 0011, plus ADR 0006, implementation, features, testing, the README (a "run a query as a job" section), and `.env.example`.

## AI usage

An AI assistant (Claude Code):

- Read the BullMQ 6 changelog and package before using it, since 6.x was newer than its training.
- Designed the job model and moved the services with `git mv` and import-rewriting scripts.
- Wrote the tests, and ran the stack live over HTTP.

## Suggestions accepted

- **Worker checks before saving:** for the coming connection jobs (3b), the user chose that the worker checks a new or changed login before it is saved.
- **Job state in Redis for now:** the `queries` table waits for Phase 8.
- **Two commits for step 3:** this is 3a.
- **Expected failures are outcomes, not exceptions.** BullMQ's "failed" then means only "something broke", which shows as a fixed `INTERNAL_ERROR`, so no library or driver text can reach a client.
- **A configurable queue name**, so the integration test uses its own queue and a locally running worker cannot take its jobs.

## Suggestions rejected

- **`@nestjs/bullmq`.** Plain BullMQ is a few lines here, and avoids one more adapter to keep in step with NestJS and BullMQ majors.
- **Running the guard in the API before queueing.** The pipeline lives in the worker, so Phase 7 can put the model before the guard without moving it again. The API still rejects bad input and someone else's connection before queueing.
- **Building the test helpers into core's `dist` as a `testing` subpath.** That would ship test code. A source mapping for tests keeps it out.

## Decisions

- A guard rejection is `retryable: true` (corrected SQL could pass). An `AppException` outcome is `retryable: false`.
- Job ids are UUIDs, and `get` checks the format before touching Redis.
- In BullMQ 6, `ioredis` is an optional peer, so core and the worker declare it. Each `JobQueue` and `JobWorker` owns its connection. The worker's connection uses `maxRetriesPerRequest: null`, as BullMQ requires. The API's fails fast, so a request adding a job errors instead of hanging while Redis is down.

## Problems found during this change

1. **The worker image did not build.** It built only `database`, `core`, and `worker`, and core now needs `shared`, `crypto`, `ssrf-guard`, and `sql-guard`. Only `docker compose up --build` showed it. Fixed in `worker.Dockerfile`.
2. **The worker's job log had no message.** nestjs-pino's Nest-style `Logger.log(fields, text)` stores the text as `context`. `JobWorker` now uses `PinoLogger.info(fields, text)`.
3. **A Jest config edit got mangled.** A JavaScript `replace` with `$'` in the replacement string inserted the rest of the file, which is the same trap noted in an earlier commit. The three configs were restored from git and patched by string slicing.

## What was checked

- **Unit tests:** API 61 (8 new HTTP tests), core 173 (16 new: job view mapping, runner outcomes, processor dispatch), worker 5 (one new: the production SSRF refusal). Guard 310 and the other packages pass. No test was lost in the move (53 + 157 = 210 before the new ones).
- **Integration:** 64, including 5 new BullMQ tests:
  - queued at once, then rows;
  - guard rejection with its reason;
  - a dropped table reported as `QUERY_SCHEMA_CHANGED`;
  - owner-only reads and malformed ids;
  - someone else's connection reported as NOT_FOUND.
- **End-to-end:** 3. ESLint, Prettier, and the build pass. No test files or fakes are in any `dist`.
- **Live check:** `docker compose up --build`, then over HTTP: create a connection to the sample database, refresh, and `POST .../queries` returned 202.
  - `GET /v1/jobs/:id` returned `succeeded` with 4 rows and the rewritten SQL (`LIMIT 1001`).
  - `DELETE FROM customers` failed with `SQL_REJECTED` and "Only SELECT is allowed, and this is DELETE."
  - The worker log shows `{"jobId":…,"kind":"query.run","ok":true,"ms":513,"message":"job finished"}`.

## Still open

- **Step 3b:** connection create, update, and test, and schema refresh, become jobs.
- **Existing log calls (not fixed here; for the user to decide):** 9 places in the API and core call nestjs-pino's `Logger` as `logger.warn(fields, 'text')`. Their text is logged as `context` and the line has no `message`. The fix is the same as in the worker: use `PinoLogger`, or pass the text first.
