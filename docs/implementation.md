# Implementation Documentation

Phase 0 of Ask Your Database. The product blueprint is the source of the phase list. This note records how the foundation was built and why.

## Approach

The repository is an npm workspace monorepo. The API and the worker are separate NestJS processes that share only published workspace packages. Phase 0 puts the error envelope and request-id rules in `@ayd/shared` so later HTTP handlers do not invent a second error shape.

Work stayed inside the Phase 0 acceptance line:

- one command starts the local stack
- CI runs lint, format check, unit tests, and build
- readiness reports the application database and Redis

Domain modules (auth, connections, SQL guard, executor, ask pipeline, history, UI) were not started.

## Technical decisions

| Topic                  | Choice                                                                                   | Why                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager        | npm workspaces                                                                           | Node 24.9+ (the current LTS line) and npm 11. No second package manager.                                                                                                                                                                  |
| API framework          | NestJS 12                                                                                | Locked by the blueprint. The API process is stateless.                                                                                                                                                                                    |
| Worker                 | Nest application context                                                                 | Same framework, separate entry point. It loads config, logging, Prisma, Redis, and the job runners from `@ayd/core`, and runs every job that opens a user database.                                                                       |
| App database access    | Prisma 7 with `@prisma/adapter-pg`                                                       | Migration history is in git. The client is generated into `packages/database/src/generated` (not committed) and reaches Postgres through the pg driver, with a 5-second connect timeout. `prisma.config.ts` loads the root `.env`.        |
| Baseline migration     | `SELECT 1`                                                                               | Creates migration history without tables that belong to later phases. The next phase adds its own migration.                                                                                                                              |
| Cache and queue broker | Redis 8 via ioredis 6                                                                    | Present now so health can report it. BullMQ arrives with the queue phase.                                                                                                                                                                 |
| Config                 | Zod parse of the environment                                                             | Invalid fields are named. Values are not printed, so a bad URL is not logged.                                                                                                                                                             |
| Logs                   | pino JSON                                                                                | `message`, level, and `service` on every line. Authorization, cookie, password, secret, and token paths are redacted. Database URLs are stripped from error text before it is logged.                                                     |
| Request id             | `x-request-id`                                                                           | Accepted when it matches a short safe pattern. Otherwise generated. pino stores it as the request id and writes it on the response.                                                                                                       |
| Errors                 | Stable envelope                                                                          | `error.code`, `error.message`, `error.requestId`. Unhandled exceptions become `INTERNAL_ERROR` with a fixed sentence. Raw driver or framework text is not returned.                                                                       |
| Health                 | `/health/live` and `/health/ready`                                                       | Live means the process is up. Ready pings Postgres and Redis. Failure is HTTP 503 with `status: degraded` and no driver message.                                                                                                          |
| Sample database        | Second Postgres on port 5433                                                             | Seeded retail tables and a `SELECT`-only role. It is not a dependency of API readiness.                                                                                                                                                   |
| Images                 | Multi-stage Dockerfiles                                                                  | Build in Node 24 Alpine, run `prisma migrate deploy` then the API. The image currently copies the workspace install, including dev dependencies, so the Prisma CLI is present. A slim runtime image is a deployment-phase task.           |
| Module format          | CommonJS output, `module: node20` (the web app is ES modules, bundled by Vite; ADR 0014) | NestJS 12 ships only as ES modules. Node 24 can `require()` an ES module, and TypeScript's `node20` mode allows it, so the code stays CommonJS. Jest needs `--experimental-vm-modules` for the same thing, which `scripts/jest.cjs` adds. |
| CI                     | GitHub Actions                                                                           | Lint, Prettier, unit tests, and compile. It does not start Docker.                                                                                                                                                                        |

## Milestones

1. Workspace, TypeScript, ESLint, and Prettier.
2. Shared error and request-id contract, with unit tests.
3. API config, JSON logging, exception filter, Prisma, Redis, and health.
4. Worker process that refuses to start when Redis is unreachable.
5. Compose stack: application Postgres, sample Postgres, Redis, API, worker.
6. CI workflow and the documentation set in `docs/`.

## Challenges

- `prisma.config.ts` requires `DATABASE_URL` even for `prisma generate`, which never connects. The generate script fills a local default when `.env` is absent, and the API image sets the variable for the build stage. Runtime still uses the real URL.
- Readiness must prove the dependencies without becoming a way to leak connection errors. Checks log a name and a URL-stripped message, and the HTTP body only says `up` or `down`.
- The worker and the API both need validated settings, logging, and Redis. They were duplicated until Phase 6, when they moved to `@ayd/core` (ADR 0006), so the worker never imports the API.
- Host ports are 5434 for the application database, 5433 for the sample database, and 6379 for Redis. 5432 is left free because many local Postgres installs already use it. Inside Compose, the API still reaches the application database at `app-db:5432`.

## Trade-offs

- Unit tests mock Postgres and Redis. CI does not prove the Compose health path. The local acceptance check is `npm run up` and `GET /health/ready`.
- The worker logs through pino directly. Nest's own logger is disabled there so boot lines stay JSON. The API uses `nestjs-pino`, which also covers request logs.
- Pretty logs are not the default. JSON is harder to scan on a laptop and is the format the blueprint requires.
- Domain tables are absent. That keeps this phase from deciding column details the auth phase should own. The cost is an empty application database until the next migration.
- Local database passwords live in Compose and in the sample seed. They are development defaults, not a secrets-manager design. Envelope encryption and a real secrets manager are later phases.

## Phase 1: authentication and users

Google sign-in uses authorization-code flow with PKCE. The code verifier sits in a short-lived encrypted httpOnly cookie, so the API process does not keep a session. The callback verifies the Google ID token with Google's published certificates and rejects an unverified email.

The access token is an HS256 JWT lasting 15 minutes by default. It is returned in JSON. The refresh token is a random secret, stored only as a SHA-256 hash, and sent back in the `ayd_refresh` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production). Rotation updates the row only if it is still unused. A second use of an old token revokes every token in that family.

`POST /v1/auth/dev/login` exists for this laptop. `loadEnv` refuses to boot when that flag is true and `NODE_ENV` is `production`. The Compose file therefore runs the API as `development`, which also lets the cookie be stored over `http://localhost`.

Account deletion writes `account.deleted` and then deletes the user. Refresh tokens cascade. The audit row's user id is set to null, and the metadata keeps the deleted id. Connections cascade with the user. History is not a table yet.

Login is not rate limited yet. That belongs with the quota phase. CSRF tokens for cookie calls belong with the hardening phase. `SameSite=Lax` is the control in place now.

Access tokens are signed in-process. The `jose` package is used only to verify Google ID tokens, because that check needs Google's JWKS. Tests do not load that package.

**Layout (reorganised 2026-10-16, no logic change).** `apps/api/src/auth/` is grouped by job:

- `index.ts`: the only file other folders import from (`AuthModule`, `AuthGuard`, `CurrentUser`, `PublicUser`, and `AuthService` for account deletion).
- `protect-routes/`: the guard and `@CurrentUser()`.
- `sign-in/`: the `/v1/auth/*` controller, `AuthService`, cookies, and the Google client.
- `tokens/`: `TokenService`.
- `storage/`: the `AuthRepository` interface and its Prisma version.

`PublicUser` and `toPublicUser` are in `auth/user.ts`. `requestMeta`, which several controllers use for audit rows, is in `apps/api/src/common/request-meta.ts`.

## Phase 2: connections, encryption, and SSRF

Connection passwords are sealed before they touch Prisma. `@ayd/crypto` generates a data key, encrypts the username and the password separately with AES-256-GCM, and wraps the data key with the master key named by `CRYPTO_MASTER_KEY_VERSION`. A later rotation calls `rewrapCredentials`, which unwraps the data key and wraps that same key again. The password ciphertext stays put. Parser failures say `invalid master key ring` and do not include the key bytes.

`@ayd/ssrf-guard` decides from a hostname plus the addresses DNS returned. The API resolves the name, and the probe connects to the pinned address, not the name, so a later DNS answer cannot swap in a private host. `servername` stays the original host so `verify-full` can check the certificate. When the user entered an IP address, no server name is sent, because TLS forbids an IP there (RFC 6066), and the certificate is checked against that IP. The pinned address is not stored. Every test resolves again.

`SSRF_ALLOW_PRIVATE` exists so this laptop can reach the sample database at `127.0.0.1` or the Compose hostname `sample-db`. Production boot refuses the flag. Cloud metadata addresses, `0.0.0.0`, and link-local ranges stay blocked even when the flag is on.

The sample image generates a self-signed certificate and turns SSL on. Clients use `sslMode: require` against it. `verify-full` is for a server with a certificate that matches the hostname.

The read-only probe is the start of the executor. Create and credential changes call it before saving. A failed retest sets `status` to `failing`, writes `connection.tested`, including when the host no longer resolves or now resolves to a blocked address, and returns `CONNECTION_FAILED`, `SSL_REQUIRED`, or `NOT_READ_ONLY`. The response text is written in the probe. Postgres error text is logged through `safeErrorDetail` and is not returned. An update that does not change the host, port, database, credentials, or SSL mode does not run the probe, so it also leaves `status` and `lastTestedAt` alone.

The privilege checks use `has_table_privilege`, `has_any_column_privilege`, `pg_has_role`, and `has_schema_privilege`. Those functions answer for the role as PostgreSQL sees it, including group roles and PUBLIC. `information_schema.role_table_grants`, used at first, lists only some of those grants and omits PUBLIC. Each check runs for every role where `pg_has_role(current_user, role, 'MEMBER')` is true, which includes roles the login can only reach with `SET ROLE`. Role attributes such as SUPERUSER are not inherited, so checking the login alone missed a login that could switch to a superuser.

`connect-error.ts` turns a failed connection into a message. It reads the SQLSTATE (`28P01`, `28000`, `3D000`), Node's socket and TLS codes, and the two fixed sentences the pg driver writes when SSL negotiation fails. It does not search the server's message. A `pg_hba.conf` rejection says "SSL encryption" in its text, and an earlier version reported it as an SSL problem.

`test/integration/user-database.probe.int-spec.ts` runs the probe against a throwaway database on the application Postgres. That server has no TLS, so the test turns SSL off in the client factory. The SSL path was checked by hand against the sample database.

`GET /v1/meta/egress` is public. Compose sets `EGRESS_IP` to the documentation address `192.0.2.10` until a real NAT gateway exists.

## Phase 3: schema introspection and allowlist

A refresh has three steps. `ConnectionService.resolveTarget` checks ownership, decrypts the credentials in memory, and pins the address through the SSRF guard. `UserDatabaseProbe.introspect` re-runs the read-only check and reads `pg_catalog` inside `BEGIN READ ONLY`, with a 15-second statement timeout. `PrismaSchemaRepository.commitSnapshot` locks the connection row, stores version n+1, replaces the allowlist, and deletes all but the newest five versions, in one transaction. The lock keeps two concurrent refreshes from taking the same version.

The snapshot is the full readable structure, not only the allowed part, because the allowlist editor has to show everything. What the model sees is computed on read by `allowedSchema`, which keeps allowed tables, allowed columns, and only the keys whose columns are all allowed. Its fingerprint hashes the version and that output. The LLM phase will key cached SQL proposals on it, so both a refresh and an allowlist edit invalidate them without a separate counter (ADR 0008).

The allowlist is explicit rows: one per allowed table and one per allowed column. A new column on an allowed table is therefore hidden until someone allows it. Defaults are applied only on the first snapshot, using the word-based hint in `sensitive-columns.ts`. The hint never reads cell values.

`PUT /v1/connections/:id/allowlist` replaces the whole list. The body names the snapshot version it was edited against. The repository compares that version again under the same row lock, so a save cannot slip in between a refresh's version change and its allowlist update.

Introspection runs in the API process, like the probe, and a refresh can take seconds on a large schema. It moves to the worker with the executor before the queue phase.

The sample database gained `multi-schema.sql`. It is mounted as a second init script, and a volume created earlier can get it with one `psql` command instead of being recreated.

## Phase 4: SQL guard

The guard is `packages/sql-guard` (ADR 0009). It parses with `libpg-query`, PostgreSQL's parser compiled to WebAssembly, pinned to 18.1.5 (the PostgreSQL 18 grammar), so it reads SQL the way the server does. `analyzer.ts` walks the parse tree. It accepts only node types and fields it knows and rejects the rest, and while walking it rewrites the tree: tables get their schema, column references get the alias they resolved to, and `*` over a table becomes the allowed columns. The top-level LIMIT is then capped.

Name resolution needs hidden columns too. The guard is given every snapshot table with every readable column marked allowed or not, and resolves an unqualified column innermost query first, as PostgreSQL does. Otherwise a hidden column in a subquery could be read under the name of an allowed column further out.

`pgsql-deparser` turns the tree back into SQL. It is not PostgreSQL's code, so its output is parsed and checked again, and has to come back unchanged. A test with a faulty deparser shows that a hidden column put back at that step is caught.

The corpus lives in `src/__fixtures__`: one attack or safe query per line, so a new case is one line. The package's Jest config requires 99% statement and 95% branch coverage.

`POST /v1/connections/:id/sql/check` is the API's use of the guard for now. `SqlGuardService` loads the connection's allowlist view, which also checks ownership and that a snapshot exists, and passes it to `checkSql` with `SQL_ROW_CAP`. A rejection is a 200 response, because checking succeeded.

The guard is one layer. ADR 0009 lists what the executor in Phase 5 must still do: a READ ONLY transaction, a statement timeout, its own row cap, and an empty `search_path` so approved function names resolve in `pg_catalog`. The rewritten SQL from the live check was run that way, as `sample_ro`, against the sample database.

## Phase 5: executor

`QueryExecutor` (ADR 0010) is the one place SQL runs on a user database. A run checks the circuit breaker, takes a Redis slot for the connection, borrows a pooled socket, opens `BEGIN READ ONLY` with `statement_timeout` and an empty `search_path`, declares a cursor over the SQL, fetches up to the row and size caps, and rolls back.

The integration tests found three defects before the commit. pg uses the simple protocol, which runs several statements, unless told otherwise, and an empty `values` array is not enough. A test with a write-capable login ran `SELECT 1; COMMIT; DELETE FROM public.t` and deleted the table's rows. The cursor and fetches now set `queryMode: 'extended'`. Second, two first calls to Redis at the same moment failed, because the second did not wait for the connection the first had started, so `RedisService` now shares one connect attempt. Third, a five-letter Node code such as `EPIPE` was taken for a SQLSTATE.

The live script found a fourth. pg returns a `date` as a JavaScript Date at local midnight, so on this laptop (UTC+5:30) `2025-08-06` printed as `2025-08-05T18:30:00Z`. The pools now return dates, times, timestamps, and intervals as the text PostgreSQL writes.

Slots and the breaker are Lua scripts on Redis, using Redis's clock. A slot is a lease token in a sorted set, valid for the statement timeout plus 10 seconds, so a crashed process frees its slots without help. The breaker counts only connection failures and timeouts. A query with an unknown column proves the database is up, so it resets the count.

`apps/api/scripts/try-query.cjs` runs connect, refresh, guard, and executor in a Nest application context against the sample database. It compiles the API itself instead of chaining `npm run build &&` in `package.json`. On Windows, npm escapes the SQL argument for `cmd.exe` with `^`, and a chained command never removes those escapes.

## Follow-up: schema changes

Two gaps were closed after Phase 5. First, editing a connection to point at another database kept the old snapshot and allowlist, so the guard would have checked queries against the wrong database's tables. `ConnectionService.update` now asks the repository to delete them in the same transaction when the host, port, or database name changes. `commitSnapshot` also refuses a snapshot whose recorded host, port, and database no longer match the connection row, which closes the race with a refresh already running.

Second, a column dropped from the customer's database after the last refresh produced a generic "could not run this query" message. `42703`, `42P01`, and `3F000` now map to `QUERY_SCHEMA_CHANGED`, which says to refresh the schema. The automatic refresh-and-retry on that code is planned for Phase 7.

## Phase 6: queue and worker

**Step 2** moved the shared infrastructure into `@ayd/core` (ADR 0006). **Step 3a** added the queue (ADR 0011). The connection, schema, and SQL-check services moved to core with their repositories, because a query job needs them in the worker; the API keeps their controllers. The API adds `query.run` jobs and reads them back; the worker's `JobWorker` hands each job to core's `JobProcessor`.

The Docker build caught what the local build could not: the worker image built only `database`, `core`, and `worker`, but core now imports `shared`, `crypto`, `ssrf-guard`, and `sql-guard`, which had to be built first. The live run caught a logging defect: nestjs-pino's Nest-style `Logger` takes its last argument as a context name, so `logger.log(fields, 'job finished')` stored the text as `context` and logged no message. The worker uses `PinoLogger`, which takes fields then a message. The same misuse in 9 earlier calls is left for Phase 10.

**Step 3b** made connection create, update, and test, and schema refresh, jobs. `ConnectionService` split create and update into the API's half (`prepareCreate`, `prepareUpdate`: validate and seal) and the worker's half (`createChecked`, `updateChecked`: open, pin, check, then store). The in-process `create` and `update` remain for `try-query` and tests. The routes answer 202, except a `PATCH` that only renames. HTTP tests use `InlineJobQueue` from `@ayd/core/testing`, which runs each job at once through the real `JobProcessor`. It imports core through the package name: apps load it from source and the rest of core from its build, and Nest otherwise saw two different `JobProcessor` classes.

**Step 4** added the progress stream, cancellation, and retries (ADR 0011). The worker loop moved into core as `startJobWorker`, so the integration tests run the same code as the worker app. `JobProcessor.handle` turns an abort, or a cancel request found at a stage, into a `JOB_CANCELLED` outcome so BullMQ does not retry it. A crashed `connection.create` could be retried after its row was stored, so the API now picks the connection's id and the worker returns the stored row when it finds one. The stream writes Server-Sent Events by hand through Express rather than Nest's `@Sse`, so the first read can still answer 404 with the error envelope, and the stream can end when the job does. A statement already running is not interrupted by a cancel: pg has no public cancel call, and the statement timeout bounds it.

**Step 5** added fair scheduling and per-user caps (ADR 0011). BullMQ's groups, which would do this directly, are a BullMQ Pro feature; a Redis slot per unfinished job caps each user, and the slot's number becomes the BullMQ priority. An integration test queues three jobs for one user and then one for another, starts a worker, and checks the run order: the first user's first job, the other user's job, then the first user's second and third.

**Phase 6 acceptance.** The API returns a job id at once (202, every route that opens a user database). Progress streams over SSE with the current stage. A crashed job is retried, and a job whose worker died is run again by another worker, safely, because every job tolerates a second run. One user cannot starve others: the cap and the priority order. Each line has a test against real Redis and BullMQ.

## Phase 7: model layer and ask pipeline

**Step 1** added the model layer (ADR 0012): a provider interface, `GeminiProvider` on Google's official SDK and the Interactions API, `LlmClient` with the fallback chain, and `FakeLlmProvider` for tests. Google moved structured output to the Interactions API in 2026, so the request fields come from the SDK's type definitions, not from memory, and the unit tests pin the exact request the provider sends. The key is optional, so the worker starts without it.

**Step 2** added the ask pipeline (ADR 0012). Its integration test runs a question through BullMQ, the real guard, and the real executor with a scripted model, and shows the guard's reason reaching the model's second attempt and the hidden `email` column never reaching the prompt. It also caught a race in `JobQueue.get`: a job that finished between loading it and reading its state looked completed with no result, and the view crashed. `get` now loads it again, and a completed state without a result reads as still running.

**Step 3** added the proposal cache (`query_cache`, migration `20261014120000_query_cache`) and self-healing on `QUERY_SCHEMA_CHANGED`. The integration test answers a question, answers it again from the cache without the model, renames the column the cached SQL reads, and checks that the job refreshes, asks again, and that the model's new prompt shows neither the old column nor the renamed one, which is new and hidden. Finding B from Phase 5 (a column type change reported as `QUERY_INVALID`) is now covered in practice: an invalid cached proposal is dropped and the model is asked with the current schema.

**Step 4** added the chart choice (`ask/chart.ts`), the server's facts (`ask/facts.ts`), the grounded summary (`ask/summary.ts`), and usage totals. Token accounting, planned as a step 5, is part of it. The summary's number check is deliberately strict: a summary with a number the data does not contain, such as a percentage change the model inferred, is replaced by the template rather than shown.

## Phase 8: history, quotas, and audit

**Step 8a** added query history (ADR 0013): the `queries` table (migration `20261014150000_query_history`), `PrismaQueryHistory` in core, recording from `JobProcessor` when a job finishes, and `apps/api/src/history`. The history integration test found a privacy defect from step 7.4: the server's facts carried labelled top items (row values) into the summary prompt and the template even when the connection did not allow rows, and a template summary naming a region was stored in history. `computeFacts` now leaves the labels out unless rows are allowed.

**Step 8b** added the limits and usage (ADR 0013). In core: `RateLimiter` and `DailyQuota` (`packages/core/src/limits/`, Lua scripts on Redis), `PrismaUsageCounters` (the `usage_counters` table, migration `20261014170000_usage_counters`), and `PrismaAuditWriter`. `JobProcessor` writes usage and the `query.rejected` audit after history. `AppException` carries an optional `retryAfterSeconds`, which the error filter sends as `Retry-After`; `tooMany()` builds one. In the API: `apps/api/src/limits/` (`SubmissionLimits` for the per-user limits, `AuthRateLimitGuard` for the per-IP sign-in limit, which lets requests through if Redis fails), used by `JobsController`, `HistoryController`, and `AuthController`, and `apps/api/src/usage/` for `GET /v1/usage`. `PrismaQueryHistory.delete` and `deleteAll` write their audit rows in the same transaction as the delete, and `PrismaConnectionRepository.delete` now does the same for `connection.deleted`, which was written before the delete in a separate step. The limits are API settings: `QUESTIONS_PER_DAY`, `SUBMISSIONS_PER_MINUTE`, `AUTH_REQUESTS_PER_MINUTE`.

## Phase 9: the web app

**Step 9a** added `apps/web` (ADR 0014): Vite, React, Mantine, TanStack Query, and React Router, with Vitest for unit tests. `src/api/client.ts` is the only place that calls the API: it adds the access token, turns the error envelope into an `ApiError`, and refreshes once on a 401. `src/auth/` keeps the session (`AuthProvider`, with the token in memory), restores it on load, and guards pages (`RequireAuth`). `src/auth/session.ts` makes sure only one refresh runs at a time, in a tab and across tabs, because the API revokes a sign-in when a refresh token is used twice. The pages so far are sign-in and the connections list, inside `AppLayout`. On the API, the Google start and callback routes now redirect the browser instead of answering with JSON. The root `build` script and both Dockerfiles include the new workspace, and ESLint applies the React hooks rules to it.

**Step 9b** added connecting a database and choosing what the AI sees. `src/api/jobs.ts` follows a job: `JobEventParser` reads the event stream, `watchJob` reconnects and falls back to polling (ADR 0014), and `runJob` starts a job and follows it. `ConnectWizardPage` (`/connections/new`) shows the egress address and setup SQL, checks the form against the API's limits, then runs `connection.create` and `schema.refresh` one after the other; if the read fails the connection is already saved, and the next step offers to read again rather than saving twice. `AllowlistSection` and `AllowlistEditor` read the schema and edit the allowlist (the full list of allowed tables and columns, sent with the version it was edited against). `ConnectionPage` (`/connections/:id`) adds the connection test and the sample-rows switch. **Step 9c** added the ask screen (`/ask`, the page after sign-in). `AskPage` picks a connection, takes a question or SQL (the guarded raw-SQL route the user chose to keep), checks the API's length limits, follows the job with `runJob`, and can cancel it. `components/answer/` shows the result: `AnswerView` (summary, chart, rows, the SQL and assumptions, cache and usage badges; ambiguous and unanswerable answers say nothing ran), `ResultChart` (stat, line, bar, pie from the server's `ChartSpec`, loaded lazily), `ResultTable` (sortable, virtualised above 100 rows), and `FailureView` (a title per failure code, the wait from `Retry-After`, the guard code for a refused query, and a link to the connection page when the schema needs reading). `pages/examples.ts` suggests up to three questions from the allowed tables. The test setup gives jsdom a stand-in for `document.fonts`, which Mantine's auto-growing text box listens to.

**Step 9d** added the last pages. `HistoryPage` (`/history`) pages through `GET /v1/history` with TanStack Query's infinite query and the API's cursor, re-runs stored SQL inline (a `query.run` job, shown with `QueryResultView`), links questions back to `/ask?connection=…&q=…`, and deletes one entry or all after a confirmation. `UsagePage` (`/usage`) shows `GET /v1/usage`. `SettingsPage` (`/settings`) shows the profile, signs out, and deletes the account (`DELETE /v1/users/me`) after the user types "delete". The ask page refreshes history and usage when a job ends.

A fix after 9b gave `watchJob` a 45-second silence limit: an API restart during a job (caused by a test run rebuilding the packages the dev server watches) left the browser's stream open through the Vite proxy with nothing arriving, and the wizard spun forever. `useUnmountSignal` stops a followed job when the page is left; it creates its controller inside an effect because React mounts components twice in development.

**Phase 9 completion** added the browser tests (`e2e/`, Playwright 1.64 with axe): the demo flow and accessibility checks at desktop and phone sizes, against their own API, worker, and web server. The worker gained `LLM_FAKE` and `ScriptedLlmProvider` for them (ADR 0012), and the Vite proxy target can be set with `AYD_API_URL` (checked with Node types in `tsconfig.node.json`). The accessibility checks found contrast below WCAG AA in Mantine's light defaults and a scrollable code block a keyboard could not reach; both were fixed (`src/theme.ts`, focusable code blocks).

## How to extend this

Add a phase only after this phase's checks pass: `npm test`, `npm run lint`, `npm run format:check`, and a ready health response from `npm run up`. New application tables go in a new Prisma migration. New client-visible failures go through `AppException` and an existing or newly documented error code in `@ayd/shared`. Use `notFound()` for a missing or foreign id (the two must look the same) and `invalidRequest()` for bad input; both live in `packages/core/src/errors/app.exception.ts`. Audit rows go through `writeAuditLog` in `packages/core/src/audit/audit-log.ts`, with ids and outcomes in the metadata and never secrets. When an audit row records a delete or change, write it in the same transaction as that change, and only when something changed (as `PrismaConnectionRepository.delete` and `PrismaQueryHistory.delete` do). Log errors with `safeErrorDetail`, which strips connection URLs. A new controller that needs a signed-in user adds `@UseGuards(AuthGuard)` and reads the user with `@CurrentUser()`, both imported from `'../auth'` rather than from files inside that folder.
