# ADR 0011: Jobs and the queue

Work that reaches a user database runs as a job in the worker, not inside an HTTP request (ADR 0003). The API adds the job and answers at once with its id; the client reads the outcome from `GET /v1/jobs/:id`. Server-Sent Events, cancellation, and retries arrive in Phase 6 step 4, and fair scheduling in step 5.

**Queue.** BullMQ 6 on the existing Redis, one queue (`JOB_QUEUE_NAME`, default `ayd-jobs`) for every kind of job. The job name is its kind. The kinds are `query.run` (step 3a) and `connection.create`, `connection.update`, `connection.test`, and `schema.refresh` (step 3b), so only the worker connects to user databases. Job ids are random UUIDs, never BullMQ's counters. The queue name is a setting so that tests, and environments that share a Redis, use their own.

**Ownership.** Every payload names its owner. `JobQueue.get(id, userId)` returns NOT_FOUND for a malformed id, a missing job, and someone else's job alike, as every other read does.

**Outcomes, not exceptions.** A runner returns `{ ok: true, result }` or `{ ok: false, error }`, where the error is a stable code from `@ayd/shared`, a message written in this codebase, and a `retryable` flag. A guard rejection is `SQL_REJECTED` with the guard's reason and code. An executor failure keeps its code. An `AppException` thrown on the way (NOT_FOUND, SCHEMA_NOT_READY) becomes an outcome. Only an unexpected error escapes, so BullMQ marks the job failed, the worker logs it through `safeErrorDetail`, and the owner sees `INTERNAL_ERROR` with a fixed sentence. No driver or library text reaches a client.

**What a query job does.** The worker loads the latest snapshot and allowlist, runs the SQL guard, resolves the connection (ownership, decrypting the credentials in memory, pinning the address through the SSRF guard), and runs the guard's SQL through the executor. Phase 7 puts the model in front of the guard; the rest stays.

**New and changed connections.** The API validates the input (400 when it is bad) and seals the credentials with the platform key; the job carries only the sealed form. The worker opens them in memory, pins the host, and runs the read-only check, and stores the connection, or the change, only if the check passes. A login that can write is never stored, as before the queue. `PATCH` answers 200 for a change that cannot reach another database or login (label, sample-rows setting) and 202 with a job otherwise. Once a job has run, the worker rewrites its stored payload without the sealed credentials, so the finished job kept for the result TTL holds none. A job that throws keeps them, for a retry (step 4), until BullMQ removes it.

**Where results live.** In Redis, as the job's return value, for `JOB_RESULT_TTL_SECONDS` (15 minutes by default); BullMQ removes finished jobs after that. The result holds at most the row cap and 5 MB. Nothing about the job is written to Postgres yet. The `queries` history table, which never holds rows, comes with Phase 8, where the blueprint specifies it.

**States.** The owner sees `queued` (BullMQ's waiting, delayed, prioritized), `running` (active), `succeeded` (completed with an ok outcome), or `failed` (completed with an error outcome, or failed by BullMQ).

**Logs.** The worker logs each finished job with its id, kind, outcome code, and duration. It never logs the SQL, which can hold customer values, or any result rows.

**Code layout.** The queue, the runners, and the services they need (connections, schema, the SQL check) live in `@ayd/core`, so the worker never imports the API. The API keeps the HTTP controllers. The worker's `JobWorker` takes jobs from BullMQ and hands each one to core's `JobProcessor`. Workers run `WORKER_CONCURRENCY` jobs at once (5 by default); the per-connection Redis slots from ADR 0010 still limit how many reach one database.
