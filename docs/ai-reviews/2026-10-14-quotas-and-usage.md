# AI review: rate limits, the daily quota, usage, and audit (Phase 8 step 8b)

Date: 2026-10-14
Base commit: `250fd9f` (feat: keep query history and keep row values out of summaries)

## What changed

**Limits (ADR 0013).**

- **Per-minute limit:** 10 submissions a minute per user (`SUBMISSIONS_PER_MINUTE`). Questions, SQL, and history re-runs share it. Past it: 429 `RATE_LIMITED` with `Retry-After`.
- **Daily quota:** 50 questions per UTC day per user (`QUESTIONS_PER_DAY`). Taken when the question is submitted, given back if it could not be queued. Past it: 429 `QUOTA_EXCEEDED` with `Retry-After` set to midnight UTC.
- **Sign-in limit:** 20 requests a minute per IP address (`AUTH_REQUESTS_PER_MINUTE`) on dev login, refresh, and the Google callback, so one source cannot flood them. Past it: 429 `RATE_LIMITED`. If Redis fails, it lets the request through and logs a warning.
- **Order:** validation, then ownership, then the rate limit, then the quota. A bad request or someone else's connection id uses up nothing.
- **Core, `packages/core/src/limits/`:**
  - `RateLimiter.hit(scope, subject, limit, windowMs)`: a sliding window in a Redis sorted set, in one Lua script using Redis's clock.
  - `DailyQuota.take / giveBack / used`: a per-day Redis counter, in Lua so two requests cannot both take the last unit; keys expire a day after their day.
  - `secondsUntilUtcMidnight()`.
- **Errors:** `RATE_LIMITED` and `QUOTA_EXCEEDED` in `@ayd/shared`. `AppException` has an optional `retryAfterSeconds`; `tooMany()` builds a 429 with it; `AllExceptionsFilter` sends it as `Retry-After`.
- **API, `apps/api/src/limits/`:** `SubmissionLimits` (used by `JobsController` and `HistoryController.rerun`) and `AuthRateLimitGuard` (on three `AuthController` routes).

**Usage.**

- **Table:** `usage_counters` (migration `20261014170000_usage_counters`, generated with `prisma migrate diff`). One row per user and UTC day: questions, rows returned, input and output tokens. Cascades with the user.
- **Worker:** `JobProcessor.record` adds each finished question or SQL job after writing history, on the day the job was submitted. A failed write goes to `onSideError`, like history.
- **API:** `GET /v1/usage` in `apps/api/src/usage/`: today's questions against the quota (from Redis), the per-minute limit, finished questions, rows, and tokens.

**Audit.**

- `query.rejected` (from the worker): SQL the guard refused for good, with the job id, connection id, kind, and guard code. Never the SQL.
- `history.deleted` (with the entry id) and `history.cleared` (with the count), written by `PrismaQueryHistory.delete` and `deleteAll` in the same transaction as the delete. The IP address comes from the API.
- `connection.deleted` moved into `PrismaConnectionRepository.delete`, in the same transaction as the delete and only when a row was deleted. `ConnectionService.delete` uses the result for its 404 and closes pools after the commit.
- The worker uses a new `AuditWriter` / `PrismaAuditWriter`, which wraps the existing `writeAuditLog`.

**Tests helpers:** in-memory `MemoryRateLimiter`, `MemoryDailyQuota`, `MemoryUsageCounters`, and `MemoryAuditWriter` in `packages/core/src/testing/memory-limits.ts`. `createHttpApp()` now provides the real limits over the in-memory limiter and quota.

**Docs:** ADR 0013 (step 8b), features, implementation (step 8b), testing, the README ("Limits and usage"), and `.env.example`.

## AI usage

An AI assistant (Claude Code) designed the limits and wrote the code, tests, and docs, following the user's choices from step 8a. After the first version, the user chose how to handle a Redis outage and a failed audit write, and asked for the sign-in limit to be described accurately.

## Suggestions accepted

- **The user's numbers:** 50 questions a day and 10 submissions a minute.
- **The user's choices after review:** the sign-in limit fails open when Redis is down; a history delete and its audit row commit in one transaction; connection deletion gets the same fix.
- **Counting in Redis**, as the blueprint asks for anything shared between instances.
- **A sliding window** rather than a per-minute counter, which lets twice the limit through across a minute boundary.
- **Taking the quota at submission**, so a burst of questions cannot all slip in before any finishes.

## Suggestions rejected

- **`@nestjs/throttler`.** It would be a new dependency and needs its own Redis storage adapter; the Lua scripts are about 30 lines and reuse `RedisService`.
- **Counting the quota when a question finishes.** Ten questions submitted at once could all pass a quota with one left.
- **Giving the question back when it ends ambiguous, unanswerable, or failed.** The model was still called; the quota exists to cap model cost.
- **A daily quota on SQL submissions.** They cost no model calls; the per-minute limit and the per-user job limit already bound them.
- **Logging a failed history audit and answering success** (offered for the failed-audit case). The user chose a transaction, so a delete never goes unaudited.

## Decisions

- **Submissions fail closed, sign-in fails open.** If Redis is down, a submission answers 500 (it needs the queue anyway); sign-in skips the limit and logs a warning, because it did not need Redis before this change.
- **The sign-in limit is about flooding, not guessing.** The app has no passwords (Google checks them), dev login is off in production, and refresh tokens are 32 random bytes. The first version of this change said "password-spraying"; corrected.
- **The sign-in limit is per IP**, not per email, so a script cannot lock a real user out by sending their email.
- **The history audit moved into the history store**, so the delete and its audit row share a transaction, the pattern `PrismaConnectionRepository.update` uses.
- **Usage is its own table**, not a count over history, so deleting history does not reset usage.
- **`GET /v1/usage` shows two question counts:** `questions.used` (the quota, which includes questions still running) and `finishedQuestions` (from the worker).

## Problems found during this change

1. **Existing HTTP tests failed** after the controllers gained the limits: their hand-built test module did not provide `RateLimiter`. Fixed by giving `createHttpApp()` in-memory defaults.
2. **The first version could answer 500 after a history entry was already deleted**, if the audit write failed; a retry then got 404. Fixed by the transaction.
3. **The first version described the sign-in limit as protection against password spraying.** The app has no passwords; corrected in the guard's comment, ADR 0013, and this file.
4. **Connection deletion audited, then deleted, in two separate writes.** A failed delete left an audit row for a delete that did not happen, and two deletes at once (a double-click) passed the ownership check together and wrote two audit rows, because the service ignored whether the delete removed anything. Found while checking this file's own claim about it, which had the order backwards. Fixed with the same transaction pattern.
5. **An edit script stopped partway** because Prettier had already reformatted an import it was looking for. No code was affected; the remaining edits were made by hand and checked by the build.

## What was checked

- **Unit tests:** core 288 (5 new: a connection delete audited once and a repeat delete not at all; usage on the submission day, the `query.rejected` audit without the SQL, no audit for other failures, a failed usage write does not fail the job).
- **API tests:** 92 (7 new HTTP tests: sign-in still works when Redis fails while a submission answers 500; the shared per-minute limit across queries, questions, and re-runs with `Retry-After`; limits kept per user; the daily quota with `Retry-After`; nothing counted for a bad request, another user's connection, or a job that could not be queued; the per-IP sign-in limit on login and refresh; `GET /v1/usage`). The history test checks that the caller's address is passed to the store for the audit.
- **Integration tests:** 95 (3 new for connection delete: delete and audit together with the IP; nothing for someone else's connection; one audit row for two deletes at once. 5 new for limits, real Redis and Postgres: one window shared by two Redis clients standing in for two API instances; exactly 10 of 30 simultaneous hits allowed; exactly 5 of 8 simultaneous quota takes, then give-back; usage summed per user and day; usage rows removed with the account). The history integration test now checks that each delete wrote its audit row with the IP, and a refused delete wrote none.
- **Other checks:** end-to-end 3, worker 5, guard 310, ssrf 25, crypto 4, shared 4 pass. ESLint, Prettier, and the full build pass. The migration was applied to the local database.

## Still open

- **Behind a proxy** every request shares the proxy's IP for the sign-in limit until Express trusts it (Phase 12).
- **A job that crashes after recording and is retried** is counted twice in usage. Rare, and only inflates the user's own numbers.
- **The frontend** should show `GET /v1/usage` and the 429 states (blueprint 12).
