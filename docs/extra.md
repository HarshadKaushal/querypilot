# Beyond the brief

What this project does in addition to the assignment brief ("Ask Your Database: AI Analytics Assistant"), and where it meets a requirement more strictly than the brief asks. Every item points to the code or decision record that shows it. Status as of 2026-10-14 (commit `afbc0d3`). Gaps against the brief are listed in [features.md](features.md), not here.

## More than the brief asked for

### Users connect their own databases

The brief asks for queries against "an approved read-only database". Here, each signed-in user connects **their own** PostgreSQL database, which needs protections the brief does not mention:

- **Address checks (SSRF guard).** The host is resolved, and loopback, private, link-local, and cloud-metadata addresses are refused. The resolved IP is pinned for the real connection, so DNS cannot be switched to an internal address halfway (`packages/ssrf-guard`, ADR 0007).
- **Encrypted credentials.** Envelope encryption: AES-256-GCM, a data key per connection, and a versioned master key. Only ciphertext is stored, and no response or log contains a password (`packages/crypto`, ADR 0007).
- **Read-only proof at connect time.** A login that is a superuser, can create objects, or holds INSERT, UPDATE, DELETE, TRUNCATE, or DDL rights on anything is refused with a message saying how to fix it. Nothing is saved until the check passes (`user-database.probe.ts`).
- **Setup instructions in the app.** The connect wizard shows the egress address, firewall advice, and a ready-to-run SQL script for a read-only role.

### Work runs in a queue, not in the request

The brief has no queue. Here, everything that opens a user database (connecting, testing, reading a schema, asking, running SQL) is a worker job (ADR 0011):

- The API answers at once with a job; a separate worker process does the work.
- **Live progress** over Server-Sent Events ("Writing the query", "Checking the query is safe", …), with **cancel**.
- Crashed jobs are retried, and jobs that run out of attempts are kept for inspection.
- **Fair scheduling.** Each user has at most 3 jobs at once, and every user's first job runs ahead of anyone's second.

### Safety layers beyond "validate SQL"

- **The SQL guard uses PostgreSQL's own parser**, not patterns, and then **parses its own output a second time** before accepting it. It is tested against 181 attack strings and 82 safe queries (`packages/sql-guard`, ADR 0009).
- **Approved functions, casts, and operators.** Anything not on the list is refused, not just known-dangerous functions.
- **Rewriting, not only checking.** Tables are schema-qualified, columns alias-qualified, `*` expanded to allowed columns only, and the top-level LIMIT is set to the row cap plus one, so a cut-off result is detected and labelled.
- **Database-level defences under the guard** (ADR 0010): a READ ONLY transaction, an empty `search_path`, a 15-second statement timeout, one statement per call, a cursor read capped at 1,000 rows and 5 MB, and `ROLLBACK`. A test shows writes fail even with the guard bypassed.
- **Shared limits across processes.** At most 2 queries at once per user database, held in Redis, and a connection pauses for 60 seconds after 5 failures in a row.

### Privacy choices the brief does not ask for

- **Result rows go to the model only if the user allows it**, per connection; the default is off. When off, the summary model sees column names, the row count, and numeric totals, and no row values at all, not even top-item labels. A test caught a leak of labels into stored summaries; it was fixed everywhere (ADR 0013).
- **Sensitive columns start hidden:** emails, phone numbers, tokens, and similar, detected by name.
- **A schema refresh never widens access.** New tables and columns start hidden until the user allows them.
- **History never stores result rows**, and a test checks the table has no column that could hold them.

### More from the model layer

- **Fallback chain.** If the primary model is rate-limited, down, or answers in the wrong shape, the next model is tried (ADR 0012).
- **One schema for prompt and validation.** The model's required JSON shape is generated from the same Zod schema that validates its answer, so the two cannot drift.
- **A lighter, faster model for summaries**, with the primary as its fallback.
- **Grounded summaries are checked.** Every number in the summary must appear in the data or the server's facts; otherwise a template summary is used instead.
- **Saved queries.** Validated SQL is cached per connection, schema fingerprint, and normalised question, so a repeated question skips the model. Rows are never cached.
- **Self-healing.** If a query fails because the database changed, the schema is read again and the question retried once.

### Accounts, limits, and audit

- **Google sign-in with PKCE**, short-lived access tokens, and rotating refresh tokens in httpOnly cookies. **Reuse detection** revokes the whole sign-in if a refresh token is used twice (`apps/api/src/auth`).
- **Limits held in Redis across instances:** 10 submissions a minute per user, 50 questions a day, and 20 sign-in attempts a minute per IP address. All are atomic Lua scripts, and a 429 carries `Retry-After` (ADR 0013).
- **An audit log** of sign-ins, connection changes, schema reads, allowlist edits, refused SQL, history deletions, and account deletion. Deletions and their audit rows are written in one transaction.
- **Usage counters** per user and day, and **account deletion** that removes everything stored for the user.

### A finished frontend

- Every state the blueprint lists has its own message: empty, truncated, ambiguous, unanswerable, refused for safety, timeout, connection down, schema not read, model unavailable, rate-limited, quota reached, cancelled, and generic failure.
- **Robust live progress.** It reconnects when the stream drops, treats 45 seconds of silence as a dead connection, and falls back to polling.
- **A results table that stays fast at 1,000 rows** (it draws only the visible rows), and chart code that loads only when an answer has a chart.
- **Accessibility checked automatically.** axe (WCAG 2.1 A and AA) runs on every page at desktop and phone sizes. It found and drove fixes for low-contrast colours and an unreachable scrolling box (ADR 0014).

## Done more strictly than the brief

| Brief                                             | This project                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Bounded retries"                                 | At most 2 retries when the guard refuses the model's SQL, and 1 retry with fixed feedback for invalid SQL. Each retry gets a sanitised reason, never raw database text.                                                                         |
| "Grounded summaries"                              | Numbers are verified against the data, with a template fallback. Without the user's permission, the model never sees row values.                                                                                                                |
| "Safe error handling"                             | One error envelope everywhere: a stable code, a fixed message written for users, and a request id. Raw database and model errors are never returned or logged with connection details.                                                          |
| "Authorization"                                   | Every lookup is scoped to the user; someone else's id gets the same 404 as a missing one. HTTP, service, and integration tests check that another user's connections, schema, SQL checks, jobs, and history stay out of reach.                  |
| "Statement timeout, row cap"                      | Also a 5 MB size cap, cursor streaming, truncation detection, and per-connection concurrency limits across processes.                                                                                                                           |
| "Track history, status, latency, and model usage" | Also tokens in and out, per-stage timings (model, query, total), whether the answer was cached, and the schema version. History can re-run stored SQL through the guard, without a model call.                                                  |
| "Unit, integration and end-to-end tests"          | About 900 automated tests (counts below), plus browser tests of the demo flow at two screen sizes. Browser tests use a **scripted model**, so the real pipeline runs without a live model, and an opt-in test asks the real model one question. |

## Tests, as last run

| Suite                                           | Tests |
| ----------------------------------------------- | ----- |
| SQL guard                                       | 310   |
| Shared core modules                             | 291   |
| API (unit and HTTP)                             | 94    |
| Web app (unit)                                  | 68    |
| SSRF guard                                      | 25    |
| Worker                                          | 6     |
| Crypto                                          | 4     |
| Shared package                                  | 4     |
| Integration (real Postgres and Redis)           | 95    |
| API end-to-end                                  | 3     |
| Browser (Playwright): 3 tests at 2 screen sizes | 6     |
| Browser, live model (opt-in)                    | 1     |

## Engineering practice

- **14 decision records** (`docs/adr/`) explaining choices that are expensive to reverse, with the alternatives rejected.
- **An AI review file for every commit** (`docs/ai-reviews/`): what changed, how AI was used, which suggestions were accepted or rejected, problems found, and what was actually run.
- **Accepted dependency advisories are written down** with the reason and when to look again (`docs/dependency-advisories.md`).
- **Every dependency on its latest stable version** when added.
