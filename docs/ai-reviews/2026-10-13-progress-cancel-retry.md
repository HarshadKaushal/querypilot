# AI review: progress stream, cancellation, and retries (Phase 6 step 4)

Date: 2026-10-13
Base commit: `f7b8726` (feat: run connection create, update, test, and schema refresh as jobs)

## What changed

**Progress.**

- Runners report a stage (`checking_sql`, `connecting`, `running_query`, `checking_access`, `reading_schema`) through BullMQ progress. A running job's view carries it.
- `GET /v1/jobs/:id/events` streams the job as Server-Sent Events: a `job` event with the full view on each change, ending when the job finishes.
- Core's `JobEvents` opens one BullMQ `QueueEvents` stream per API process and fans it out by job id.
- The stream also re-reads every 2 s (a safety net for missed events), sends a keep-alive comment every 15 s, and ends after 10 minutes.
- A missing or foreign job is a normal 404 before any header is sent.

**Cancellation.**

- `POST /v1/jobs/:id/cancel` returns 202 with `cancelRequested: true`, or 200 with the job unchanged if it had already finished.
- Core's `JobCancellation` sets a Redis key (catches waiting jobs) and publishes on a channel (reaches running jobs).
- Every worker subscribes, and the one running the job calls BullMQ's `cancelJob`, which aborts the job's signal.
- **Where the job stops:**
  - Runners check the signal between stages.
  - The executor checks before connecting, while waiting for a slot, and between batches of rows. When it stops mid-cursor, it discards the socket and frees the slot.
  - Each stage also re-checks the key.
  - The outcome is `JOB_CANCELLED`, shown as state `cancelled`, and is never retried.
  - A cancelled create or update stores nothing.

**Retries and dead-letter.**

- Jobs get `JOB_ATTEMPTS` runs (3) with exponential backoff from 1 s. Only crashes are retried; expected failures are outcomes.
- BullMQ finds a dead worker's job stalled when its lock expires, and runs it again.
- A job with no attempts left stays in the failed set for `JOB_FAILED_RETENTION_SECONDS` (7 days), with its sealed credentials removed. The worker logs it as given up.

**Safe to run twice.** `connection.create` now carries an id chosen by the API (`PendingCreate`). A retried job that finds its row returns it, without a second check, row, or audit entry.

**Code layout:**

- The worker loop moved into core as `startJobWorker()`, so the integration tests run the worker app's own code. The app's `JobWorker` runs it and logs its hooks.
- `JobProcessor.handle(job, { signal, onSideError })` replaces the earlier `(job, onCleanupError)`.
- Shared adds `JOB_CANCELLED`.
- New settings: `JOB_ATTEMPTS` and `JOB_FAILED_RETENTION_SECONDS`.
- Docs: ADR 0011 (states, stream, cancellation, retries), features, implementation, the README (streaming with `curl.exe -N`, and cancel), and `.env.example`.

## AI usage

An AI assistant (Claude Code) read BullMQ 6's type definitions for `cancelJob`, `AbortSignal`, `updateProgress`, and `QueueEvents` before using them. It wrote the code and tests, and ran the stream and cancellation live through Docker.

## Suggestions accepted

- **One event type carrying the full job view**, re-read on every change, rather than a separate payload per event type. A client never needs to merge partial updates, and a missed or repeated event does no harm.
- **The `Authorization` header for the stream**, with no token in the URL, because URLs end up in access logs. The browser client will use fetch-based SSE; polling stays the fallback.
- **Turning a cancellation into an outcome**, so BullMQ never retries a job its owner stopped.
- **Moving the worker loop into core**, so the crash, stall, and cancel behaviour is tested exactly as it runs.

## Suggestions rejected

- **Nest's `@Sse` decorator.** It would start the stream before ownership is checked, and it cannot end the stream when the job finishes as simply. Writing the events through Express keeps the 404 envelope and the end condition in our hands.
- **Interrupting a running SQL statement with `pg_cancel_backend`.** pg has no public cancel call. Doing it ourselves needs a second connection to the customer's database, against their connection limits and our egress rules. The statement timeout (15 s) bounds the wait, and the executor stops at the next batch.
- **Removing a waiting job from BullMQ on cancel.** The owner would then get 404 instead of seeing `cancelled`.

## Decisions

- `cancelRequested` is shown only while a job is queued or running. Afterwards the state says what happened.
- The cancel key lasts a day, enough for any wait in the queue. The channel is shared across queues; job ids are UUIDs.
- A failed progress write or payload cleanup is reported through `onSideError` and never fails the job.
- The stall test uses a 1-second lock. Production uses BullMQ's default (30 s); a setting can come with deployment if needed.

## What was checked

- **Unit tests:** core 199 (new: the processor's cancellation paths, stage recording, side-write failures, payload cleanup; the executor's abort before connecting and between batches, with socket discarded and slot freed; job views for `cancelled`, stages, and retry-wait; an idempotent create; nothing stored when cancelled after the check).
- **API tests:** 72 (new HTTP tests for the stream: finished job, a sequence of event-driven changes, a change caught by the re-read with keep-alives, 404 with the envelope, 401; and for cancel's 202 and 200). Worker 5, guard 310, and the other packages pass.
- **Integration:** 73, including 6 new BullMQ tests:
  - events reach a subscriber in another process;
  - a waiting job is cancelled without running;
  - a running job is cancelled through its signal;
  - a crash is retried and then succeeds;
  - a job is given up after 2 attempts, kept as failed with `INTERNAL_ERROR`, and its credentials removed;
  - a worker "killed" mid-job (force-closed) has its job run again by another worker.
- **End-to-end:** 3. ESLint, Prettier, and the build pass.
- **Live check** (`docker compose up --build`):
  - `curl -N` on `/v1/jobs/:id/events` showed `running checking_sql`, `connecting`, `running_query`, then `succeeded` with 4 rows.
  - With the worker stopped, cancel answered 202. After a restart the job ended `cancelled` without running.

## Still open

- **Step 5:** fair scheduling between users and per-user job caps, then the Phase 6 docs pass.
- **Phase 10:** the 9 earlier log calls that store their message as `context`.
