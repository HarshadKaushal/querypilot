# AI review: connection and schema work as worker jobs (Phase 6 step 3b)

Date: 2026-10-13
Base commit: `a83d7e4` (feat: run queries as worker jobs through a BullMQ queue)

## What changed

Every route that opens a user database now queues a job. The API no longer connects to user databases, which ADR 0003 asked for from the start.

| Route                                     | Before                               | Now                                                                                   |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| `POST /v1/connections`                    | 201 with the connection, or an error | **202** job `connection.create`; bad input still **400** at once                      |
| `PATCH /v1/connections/:id`               | 200 with the connection              | **200** for a rename or sample-rows change; **202** job `connection.update` otherwise |
| `POST /v1/connections/:id/test`           | 201 with the connection, or an error | **202** job `connection.test`; someone else's connection is **404** at once           |
| `POST /v1/connections/:id/schema/refresh` | 201 with the summary, or an error    | **202** job `schema.refresh`; **404** at once if not yours                            |

**A new or changed login is saved only after the worker's check, as the user chose.**

- `ConnectionService` now has two halves.
- **The API's half** (`prepareCreate`, `prepareUpdate`) validates the input and seals the credentials.
  - Nothing is stored and no database is contacted.
  - A label-only change is saved at once.
- **The worker's half** (`createChecked`, `updateChecked`) opens the credentials in memory, pins the host, and runs the read-only check, then stores the connection only if it passes.
  - A write-capable login is never stored.
  - A failed update leaves the old settings.
- The in-process `create` and `update` stay for `try-query` and tests.

**No credentials in finished jobs.**

- The job payload carries only the sealed credentials.
- `JobProcessor.handle` runs a job, then rewrites its stored payload without them (`withoutCredentials`).
- A failed rewrite is logged, not thrown, because the work is done.
- A job that throws keeps its payload, so a retry in step 4 can still run.

**Core:**

- `ConnectionJobRunner` (create, update, test, refresh) returns outcomes.
- `JobProcessor` dispatches all five kinds.
- `jobView` takes a small `JobFields` type.

**Tests:**

- `InlineJobQueue` in `@ayd/core/testing` runs each job at once through the real `JobProcessor`.
- `inlineJobProviders()` sets it up for HTTP tests.
- The connections, schema, and SQL-check HTTP tests now go through jobs.

**Docs:** ADR 0011 (new and changed connections), ADR 0003 and 0008 (only the worker connects), features, implementation, testing, and the README (a `Wait-AydJob` helper and the 200/202 rule for `PATCH`).

## AI usage

An AI assistant (Claude Code) split the service, wrote the runner, the payload cleanup, the test queue, and the tests, rewrote the affected HTTP tests, and ran the whole flow live over HTTP through Docker.

## Suggestions accepted

- **The worker checks, then saves** (user's choice).
- **Drop sealed credentials from a finished job**, so Redis holds none once a job has run.
- **A test queue that runs real jobs in process**, so HTTP tests cover the full flow (create, check, save, read the job) without Redis.

## Suggestions rejected

- **Always answering `PATCH` with a job.** A rename never opens the database, so it stays synchronous (200).
- **Resolving and SSRF-checking the host in the API before queueing**, for faster feedback. The worker must pin the address it connects to anyway, so one check, in the worker, avoids two code paths that could disagree.

## Decisions

- **The API still decrypts the saved credentials in `prepareUpdate`.** It needs them to tell whether a new password differs from the old one. It opens no connection with them.
- **Pool eviction is only within the process.** After an update, the worker that ran it evicts its own pool for the connection. Other worker processes open a new pool on their next query, because pools are keyed by a hash of the address and credentials. Their old idle sockets close after 10 seconds.
- **A failed create writes no audit row**, as before.

## Problems found during this change

1. **Two copies of `JobProcessor`.** The test queue was loaded from core's source (through the `@ayd/core/testing` mapping) and imported `JobProcessor` by relative path. The tests got `JobProcessor` from core's build. To Nest these were different classes, so it could not inject one into the other. The test helpers now import runtime classes through `@ayd/core`.
2. **The shell failed on long scripts with mixed quotes.** Two scripts were written to files and run from there. No code effect.

## What was checked

- **Unit tests:** API 66, core 186, worker 5, guard 310, and the other packages pass.
  - **New core tests:** the halves contact nothing and store nothing; a write-capable login is never stored; a failed update keeps the old password; the runner's outcomes; payload cleanup, including its failure and a throwing job.
  - **New HTTP tests:** create to job to saved connection; a write-capable login stores nothing; bad input gets 400 at once; rename gets 200; a new host gets 202 and is saved after the check; a failed password change keeps the old one; test gets 202, and someone else's connection 404.
- **Integration:** 67, including 3 new BullMQ tests against a real database:
  - a write-capable login is never stored;
  - create, refresh, test, and a failed password change that leaves the login working;
  - a finished job's stored payload has no `passwordCiphertext` or `encryptedDataKey` but keeps the settings.
- **End-to-end:** 3. ESLint, Prettier, and the build pass.
- **No API path to a user database:** a search of `apps/api/src` finds no call to the probe, introspection, or executor.
- **Live check** (`docker compose up --build`, over HTTP, against the sample database):
  - Create with `sample_ro` succeeded.
  - Create with `sample_admin` failed with `NOT_READ_ONLY`, and the connection count stayed 1.
  - Refresh, query, and test succeeded; rename answered 200.
  - The worker logged each job with its kind and outcome code.

## Still open

- **Step 4:** SSE progress, cancellation, and retries with a dead-letter policy.
- **Step 5:** fair scheduling and the Phase 6 docs pass.
- **Phase 10:** the 9 earlier log calls that store their message as `context` (user's decision).
