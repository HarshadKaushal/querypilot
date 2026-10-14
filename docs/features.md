# Feature Documentation

Status of Ask Your Database against the production blueprint. Phase 6 (queue, worker, and progress streaming) is complete; Phase 7 (the LLM and the ask pipeline) is next.

## Completed

- npm workspace with `apps/api`, `apps/worker`, `packages/core`, `packages/shared`, `packages/database`, `packages/crypto`, `packages/ssrf-guard`, and `packages/sql-guard`.
- ESLint, Prettier, and a GitHub Actions workflow that runs lint, format check, unit tests, and build.
- Docker Compose for the application Postgres, Redis (AOF enabled), and a seeded sample Postgres.
- Docker images and process entrypoints for the API and the worker.
- Environment validation for the API (including the master-key ring and `SSRF_ALLOW_PRIVATE`) and the worker (the shared core settings, including the database, Redis, the master-key ring, and the job settings). `SSRF_ALLOW_PRIVATE` cannot be true in production.
- Structured JSON logs with redaction of credential-like fields and database URLs inside error messages.
- `x-request-id` on responses, reused when the client sends a safe value.
- Error envelope for 404, application errors, and unexpected failures. Unexpected messages are replaced with a fixed sentence.
- Prisma schema and migrations in `packages/database`. The API container runs `prisma migrate deploy` from that package on startup.
- Liveness at `GET /health/live`.
- Readiness at `GET /health/ready`, covering the application database and Redis.
- Sample retail schema (customers, products, orders, order items, payments) and a read-only login, `sample_ro`.
- Root `README.md` with setup and run instructions.
- `.env.example` with local URLs and no third-party secrets.
- Google OIDC start and callback with PKCE, answering the browser with redirects (to the web app, or to its sign-in page with an error code). The ID token is verified against Google's certificates. Unverified emails are rejected.
- Local development login at `POST /v1/auth/dev/login`, enabled only when `DEV_LOGIN_ENABLED=true` and `NODE_ENV` is not `production`.
- Short-lived HS256 access tokens and rotating refresh tokens. The refresh token is stored as a hash and returned only in an httpOnly cookie.
- Refresh reuse revokes the token family. Logout revokes the presented token. `GET /v1/users/me` rejects missing or invalid access tokens.
- Account deletion removes the user and refresh tokens and writes an audit row. Connections, schema snapshots, and allowlist rows are removed by foreign keys with `ON DELETE CASCADE`. Query history is not stored yet.
- Envelope encryption in `@ayd/crypto`. A random data key encrypts the username and password. The current master key wraps that data key. `rewrapCredentials` rotates only the wrap.
- SSRF checks in `@ayd/ssrf-guard`. Metadata, unspecified, and link-local addresses are always rejected. Loopback and private ranges are rejected unless `SSRF_ALLOW_PRIVATE` is on, which production refuses. The hostname `localhost` follows that same switch. A mixed public and private answer is rejected.
- Connection create, list, get, test, update, and delete under `/v1/connections`. Rows are scoped by `user_id`. Another user's id is `404`.
- SSL modes `require` and `verify-full` only. `disable`, `allow`, and `prefer` are `SSL_REQUIRED`.
- Read-only probe in the executor module (`packages/core/src/user-database/`). Superuser, write grants, table ownership, and schema `CREATE` are `NOT_READ_ONLY` with a fixed message. Write grants and ownership count when they come through a group role or PUBLIC. The probe is the only code that opens a user database.
- Connection failures are explained from the Postgres error code or the socket and TLS code, never from the error text: wrong password, a `pg_hba.conf` rejection, an unknown database, a closed port, no answer, no SSL, and a certificate that does not verify each get their own message.
- Public egress helper at `GET /v1/meta/egress` (`EGRESS_IP`, setup SQL, firewall note).
- Sample Postgres speaks TLS. The image generates a self-signed certificate on first start.
- Audit events for login, logout, refresh reuse, and account deletion.
- Application tables `users`, `refresh_tokens`, and `audit_log`.
- Schema refresh at `POST /v1/connections/:id/schema/refresh`. It re-checks that the login is read-only, then reads the tables, views, materialized views, foreign tables, and partitioned tables the login can SELECT, with columns, types, nullability, primary keys, and foreign keys, inside a READ ONLY transaction. It reads no rows and no comments. Each refresh stores a new snapshot version, and the newest five are kept. Above 2,000 tables or 50,000 columns it returns `SCHEMA_TOO_LARGE`.
- Allowlist. The first snapshot allows every table and every column the sensitive-column hint does not flag (emails, phone numbers, addresses, national ids, dates of birth, card and bank numbers, credentials). Later refreshes keep existing choices, drop objects that are gone, and leave new objects hidden. The refresh response lists them.
- `GET /v1/connections/:id/schema` returns only allowed tables and columns, with descriptions and a fingerprint that changes on every refresh and allowlist edit. `GET /v1/connections/:id/allowlist` lists every object with `allowed` and `sensitive` flags. `PUT /v1/connections/:id/allowlist` saves choices and descriptions against a snapshot version, and returns `SCHEMA_CHANGED` if a refresh happened since.
- Multi-schema sample database: `inventory` and `support` are readable by `sample_ro`, and `finance` is not.
- SQL guard in `@ayd/sql-guard`, on PostgreSQL's own parser. It accepts one SELECT, optionally with non-recursive WITH queries, over allowlisted tables and columns, using approved functions, cast types, and operators. Writes, DDL, `COPY`, `SELECT INTO`, locking clauses, system catalogs, hidden columns, whole-row references, recursive queries, and functions in FROM are rejected with a code and a reason. The SQL it returns has schema-qualified tables, alias-qualified columns, `*` expanded to allowed columns, and a top-level LIMIT capped at `SQL_ROW_CAP` plus one, the extra row telling the executor the result was cut. Its output is parsed and checked a second time. 181 attack cases and 82 safe queries.
- `POST /v1/connections/:id/sql/check` runs the guard against the connection's latest allowlist and returns the verdict. It never runs the SQL.
- Changing a connection's host, port, or database name deletes its snapshots and allowlist in the same transaction. The next refresh starts over with the defaults. A refresh that read the old database during the edit stores nothing (`SCHEMA_CHANGED`).
- A column, table, or schema the database no longer has returns `QUERY_SCHEMA_CHANGED`, which tells the user to refresh the schema.
- Connection create, update (a new host, port, database, login, or SSL mode), and test, and schema refresh, run as worker jobs too. The API never connects to a user database. A new or changed login is saved only after the worker's read-only check passes, and the job payload carries the credentials only sealed; finished jobs keep none.
- `GET /v1/jobs/:id/events` streams a job to its owner as Server-Sent Events: the full view on every change, with the current stage (`checking_sql`, `connecting`, `running_query`, `checking_access`, `reading_schema`), ending when the job finishes. Authentication is the `Authorization` header.
- `POST /v1/jobs/:id/cancel` stops a waiting job before it runs and a running one at its next step or batch of rows; the job ends `cancelled`. A cancelled create or update stores nothing.
- A crashed job, or one whose worker died, is retried up to 3 times with backoff; one with no attempts left is kept 7 days for inspection, without its credentials. Creating a connection is safe to retry.
- A user may have 3 unfinished jobs at once; a fourth is refused with `TOO_MANY_JOBS` (429). Each user's first job runs ahead of anyone's second, so one heavy user cannot starve the others.
- Query history (ADR 0013): every finished question or SQL job is recorded with what was asked, the SQL that ran, the outcome, the summary, and its cost, never result rows. `GET /v1/history` pages newest first with a keyset cursor; entries can be viewed, re-run (the stored SQL runs again through the guard, with no model call), or deleted one by one or all at once.
- Limits (ADR 0013): 10 submissions a minute per user (questions, SQL, and re-runs together) and 50 questions per UTC day, both counted in Redis across every API instance; past them the API answers 429 `RATE_LIMITED` or `QUOTA_EXCEEDED` with `Retry-After`. A question that could not be queued is given back. Sign-in, refresh, and the Google callback are limited to 20 a minute per IP address; this limit steps aside if Redis is down. `GET /v1/usage` shows today's questions against the limit, rows returned, and tokens.
- Queries run as worker jobs (ADR 0011). `POST /v1/connections/:id/queries` checks ownership and the SQL's size, queues a BullMQ job, and answers 202 with the job. The worker runs the guard and the executor. `GET /v1/jobs/:id` shows the owner `queued`, `running`, `succeeded` with the rows, or `failed` with a stable code and a fixed message; anyone else gets 404. Results stay in Redis for 15 minutes.

## Partial

- **Web app (Phase 9 step 9a).** `apps/web`: sign in with Google or, in development, the dev login; the session survives a reload and refreshes itself; the connections list with status and delete. Pages for connecting a database, asking, history, usage, and settings follow in steps 9b to 9d.

- **Ask pipeline (Phase 7 step 2).** `POST /v1/connections/:id/questions` answers a question in English as a job: the model proposes SQL over the allowlisted schema, the guard checks it (a rejection is sent back to the model, at most twice), and the executor runs it. Ambiguous and unanswerable questions stop before anything runs, with a clarifying question or an explanation. A repeated question is answered from a cache of validated SQL (per schema fingerprint, never rows), and a query that fails because the database changed refreshes the schema and tries once more. Each answer also carries a chart choice (stat, line, bar, pie, or table, by fixed rules), server-computed facts, a two- or three-sentence summary from a lighter, faster model (`gemini-3.5-flash-lite`, then the primary) whose numbers are checked against the data (a template replaces it otherwise), and token and timing totals. Result rows go to the model for the summary only when the connection allows it; otherwise the summary sees only column names, the row count, and numeric totals, with no labels.
- **Model layer (Phase 7 step 1).** `LlmClient` asks Gemini (`gemini-3.8-flash`, falling back to `gemini-3.5-flash-lite`) for JSON in a Zod-defined shape, through the official SDK and the Interactions API, and falls back on rate limits, outages, and malformed answers (ADR 0012). The ask pipeline uses it. `npm run try-llm --workspace=@ayd/worker` checks a key.

- **Worker.** It takes every job that opens a user database from the queue (query, connection create, update, and test, schema refresh) and runs them, five at a time per process. It reports progress, honours cancellation, retries crashes, and keeps each user to their share of the queue.
- **Shared package.** It holds the error envelope, request id, and health report types. It does not yet hold API DTOs for questions, connections, or history.
- **Observability.** Logs are structured. There are no traces, metrics, dashboards, or alerts.
- **API surface.** Health stays unversioned. Auth and the current user live under `/v1`. There is still no Swagger document.
- **Audit log.** Login, logout, refresh reuse, account deletion, connection create, update, test, and delete, schema refreshes, allowlist edits, SQL the guard rejected (without the SQL), and history deletions are recorded.
- **Account deletion.** The user row, refresh tokens, connections, snapshots, allowlists, cached proposals, query history, and usage counters go away.
- **Executor.** It tests connections, reads schemas, and runs guarded SQL: a READ ONLY transaction, a statement timeout (15 s), an empty `search_path`, a cursor read up to 1,000 rows and 5 MB, then `ROLLBACK`. One statement only, through the extended protocol. Two queries at once per connection across all processes, through Redis slots. A connection pauses for 60 s after 5 connection failures or timeouts in a row. There is one pool per connection, closed when credentials change or the connection is deleted. Errors map to fixed messages with a `retryable` flag. It runs only in the worker, from jobs.
- **SQL cache invalidation.** The schema fingerprint is ready to key the SQL proposal cache, which arrives with the LLM phase.

## Pending

Locked choices that are not implemented:

- Show how old the schema snapshot is, or refresh it on a schedule (Phase 8 or 9).
- Web app pages for connecting a database and choosing the allowlist (9b), asking with live progress, the table, chart, and summary, and every result state (9c), and history, usage, and settings (9d).
- Evaluation dataset, load tests, and production deployment (NAT gateway, fixed egress IP, secrets manager).

Out of scope for v1, from the blueprint: databases other than PostgreSQL, SSH tunnels, per-tenant egress IPs, team workspaces, scheduled reports, write access, stored result rows, and custom model fine-tuning.
