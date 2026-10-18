# Ask Your Database

Middleware that lets a signed-in user connect their own PostgreSQL database and ask questions in plain English. The platform proposes SQL, checks it, runs it read-only, and returns a table, a chart, the SQL, and a short summary.

Phases 0 to 9 are done: sign-in, connecting a database, choosing what the AI sees, asking questions, history, limits, and the web app, with browser tests and accessibility checks. See [docs/features.md](docs/features.md) for what works today.

## How it works

1. **Web app (`apps/web`):** the user asks a question in the browser.
2. **API (`apps/api`):** it checks the user and their limits, puts a job on a Redis queue, and answers at once with the job.
3. **Worker (`apps/worker`):** it takes the job and does the work.
   1. Gemini writes one `SELECT` over the tables the user allowed.
   2. The SQL guard parses and checks it.
   3. The worker runs it read-only on the user's database.
   4. It adds a chart and a summary.
4. **Back in the browser:** the job's progress and answer stream back to the page.

The worker is the only process that opens a user's database or calls the model. Result rows are shown but never stored.

[docs/request-flow.md](docs/request-flow.md) follows one question through every file, from the button to the answer.

## Quick start

With Node 24.9+, npm 11, and Docker Desktop running:

```powershell
copy .env.example .env
npm ci
npm run up:deps      # Docker: app database :5434, sample database :5433, Redis :6379
npm run dev          # API on :3000 (applies nothing itself; see migrations below)
npm run dev:worker   # in a second terminal
npm run dev:web      # in a third terminal; open http://localhost:5173
```

Apply migrations once before the first run (see [Run the API on the host](#run-the-api-on-the-host)). In development, the sign-in page offers a dev login, so Google is not needed. Asking in English needs `GEMINI_API_KEY` in `.env`; SQL you write yourself runs without it.

## Where things are

```text
apps/web              React web app (Vite, Mantine, TanStack Query)
apps/api              NestJS HTTP API: sign-in, validation, limits; queues jobs
apps/worker           NestJS worker: takes jobs from the queue and runs them
packages/core         Nest modules both processes share: the ask pipeline, jobs,
                      connections, schema, SQL check, executor, model, history, limits
packages/sql-guard    SQL checks and rewriting, on PostgreSQL's own parser
packages/database     Sequelize models, types, enums, and migrations
packages/crypto       Envelope encryption for connection secrets
packages/ssrf-guard   Host and address checks for user databases
packages/shared       Error envelope, request id, health report types
e2e                   Playwright browser tests
infra/docker          API and worker images
infra/sample-db       Seed and TLS entrypoint for the sample user database
docs                  Request flow, conventions, decisions (ADRs), and reviews
```

Every app and package has a short README of its own.

## Where to start reading

1. [docs/request-flow.md](docs/request-flow.md): one question from the browser to the database and back.
2. [docs/conventions.md](docs/conventions.md): file names, comment style, how errors and validation work.
3. The entry points:
   - `apps/web/src/app/router.tsx`: which page each URL shows.
   - `apps/api/src/app.module.ts`: every API module.
   - `packages/core/src/ask/ask-job.runner.ts`: answering a question.
4. [docs/README.md](docs/README.md): the index of design decisions (ADRs) and the rest of the docs.

## Prerequisites

- Node.js 24.9 or newer (the current LTS line). Jest needs 24.9 to load NestJS 12.
- npm 11
- Docker Desktop, with the Docker Compose v2 plugin

## First-time setup

From the repository root:

```powershell
copy .env.example .env
npm ci
```

`.env` is for processes you run on the host. It is gitignored. The Compose stack passes its own environment into the `api` and `worker` containers and does not read `.env`.

## Run the full local stack

One command builds the images and starts the application database, Redis, the seeded sample database, the API, and the worker:

```powershell
npm run up
```

That is `docker compose up --build`. The API listens on port 3000. Stop it with Ctrl+C, then:

```powershell
npm run down
```

`npm run down` stops containers. Named volumes keep the databases. To recreate the sample seed, remove the `sample_db_data_18` volume before starting again. The volume names end in the Postgres major version, because Postgres 18 cannot open data written by 16.

## Run the API on the host

Use this while changing API code. Dependencies stay in Docker. `npm run dev` compiles the API with `tsc --watch` and restarts it with `node --watch` when the output changes. It reads the root `.env`.

```powershell
npm run up:deps
npm run dev
```

In a second terminal:

```powershell
npm run dev:worker
```

Apply database migrations before expecting readiness to pass:

```powershell
$env:DATABASE_URL = "postgresql://ayd:ayd@localhost:5434/ayd"
npm run migrate --workspace=@ayd/database
```

The schema lives in `packages/database`: Sequelize models in `src/tables/` (one folder per table) and sequelize-cli migrations in `migrations/` (ADR 0015). The command reads `DATABASE_URL` from the root `.env` when it is not set. `npm run migrate:status --workspace=@ayd/database` lists which migrations have run. On a database that Prisma migrated before 2026-10-16, the first run records Prisma's history for sequelize-cli and then converts the time columns to `TIMESTAMPTZ`; nothing else changes. The container entrypoint runs that migrate command on its own, so `npm run up` does not need this step.

## Run the web app

The web app runs on the host with Vite. Start the API and the worker first (either way above), then:

```powershell
npm run dev:web
```

Open http://localhost:5173. The dev server passes `/v1` requests to the API on port 3000, so the page and the API share one address and the sign-in cookie works. In development the sign-in page also offers the dev login. The worker must run too: connecting a database, testing it, reading its schema, and asking all run as worker jobs, and the app shows their progress live. Asking needs `GEMINI_API_KEY` in `.env` for the worker; SQL you write yourself runs without it. Do not run test or build commands while using the app: they rebuild packages the API and worker run from, and both restart. To try the sample database from the host, connect to host `127.0.0.1`, port `5433`, database `sample`, user `sample_ro`, password `sample_ro_password`, SSL `require`. `npm run build --workspace=@ayd/web` type-checks and writes the production files to `apps/web/dist`.

### API docs (Swagger)

Outside production, the API serves interactive docs at http://localhost:3000/docs, generated from the controllers. The raw OpenAPI document is at `/docs/openapi.json` (and `/docs/openapi.yaml`). To call a protected route from the page:

1. Open `POST /v1/auth/dev/login`, press **Try it out**, then **Execute**.
2. Copy `accessToken` from the response.
3. Press **Authorize** at the top, paste the token, and close the dialog.

Protected routes then send it. The token lasts 15 minutes by default (`AUTH_ACCESS_TTL_SECONDS`). Request bodies are shown from their DTO classes (the "Schemas" section at the bottom), and those same classes validate every request: a body with a wrong type answers 400 `VALIDATION_ERROR` naming the field, and fields a DTO does not declare are dropped. Every response is documented too, with its fields and examples; a job's `result` depends on its `kind`, as its description says.

## Try the API by hand

The sections from here to "Local databases" call the API from PowerShell, one feature at a time. They are not needed to use the web app, but they show what each route does.

## Check that it is up

Liveness (process only):

```powershell
curl http://localhost:3000/health/live
```

Readiness (application Postgres and Redis):

```powershell
curl http://localhost:3000/health/ready
```

A healthy readiness body looks like:

```json
{
  "status": "ok",
  "checks": {
    "appDatabase": { "status": "up", "latencyMs": 3 },
    "redis": { "status": "up", "latencyMs": 1 }
  }
}
```

If either dependency is down, the status is `degraded` and the HTTP status is 503. Dependency error text is not included in the response.

Every response carries `x-request-id`. Send your own id to correlate logs:

```powershell
curl -H "x-request-id: demo-req-01" http://localhost:3000/health/live
```

Ids must be 8 to 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`. Anything else is replaced with a generated id.

Unknown routes return the error envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "That resource was not found.",
    "requestId": "demo-req-01"
  }
}
```

## Sign in

The local Compose stack runs with `NODE_ENV=development` and `DEV_LOGIN_ENABLED=true`. That login is refused if `NODE_ENV` is `production`.

```powershell
$login = Invoke-RestMethod http://localhost:3000/v1/auth/dev/login -Method Post -ContentType "application/json" -Body '{"email":"dev@localhost","name":"Local developer"}' -SessionVariable session
$login.user
```

`$login` contains `accessToken`, `expiresIn`, and `user`. The refresh token is only in the `ayd_refresh` httpOnly cookie, held by `$session`.

```powershell
Invoke-RestMethod http://localhost:3000/v1/users/me -Headers @{ Authorization = "Bearer $($login.accessToken)" }
Invoke-RestMethod http://localhost:3000/v1/auth/refresh -Method Post -WebSession $session
Invoke-RestMethod http://localhost:3000/v1/auth/logout -Method Post -WebSession $session
```

`POST /v1/auth/refresh` rotates the cookie. Presenting the previous refresh token again revokes that whole login family. A request without a bearer token gets `401` and `UNAUTHENTICATED`.

Google sign-in is `GET /v1/auth/google/start`, opened by the browser. It redirects to Google after you set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Google sends the browser back to the callback, which sets the refresh cookie and redirects to the web app (`APP_WEB_ORIGIN`). Until Google is configured, and whenever sign-in fails, the browser lands on the web app's sign-in page with the error code, such as `/sign-in?error=AUTH_NOT_CONFIGURED`.

## Connect a database

`GET /v1/meta/egress` is public. It returns the egress IP to allowlist and SQL for a SELECT-only role.

Anything that opens a user database runs in the worker: creating a connection, changing its host or login, testing it, reading its schema, and running a query. Those routes answer HTTP 202 with a job at once, and `GET /v1/jobs/{id}` reports the outcome. Start the worker with `npm run up`, or `npm run dev:worker` next to `npm run dev`.

The sample database speaks SSL. From the host, with `SSRF_ALLOW_PRIVATE=true` in `.env`:

```powershell
$login = Invoke-RestMethod http://localhost:3000/v1/auth/dev/login -Method Post -ContentType "application/json" -Body '{"email":"dev@localhost","name":"Local developer"}' -SessionVariable session
$auth = @{ Authorization = "Bearer $($login.accessToken)" }
function Wait-AydJob($job) {
  while ($job.state -in 'queued', 'running') {
    Start-Sleep -Milliseconds 200
    $job = Invoke-RestMethod "http://localhost:3000/v1/jobs/$($job.id)" -Headers $auth
  }
  $job
}
$body = '{"label":"Sample","host":"127.0.0.1","port":5433,"databaseName":"sample","username":"sample_ro","password":"sample_ro_password","sslMode":"require"}'
$created = Wait-AydJob (Invoke-RestMethod http://localhost:3000/v1/connections -Method Post -ContentType "application/json" -Headers $auth -Body $body)
$conn = $created.result
```

The worker runs the read-only check first and saves the connection only if it passes. A failed check leaves nothing stored: the job's `error.code` says why (`NOT_READ_ONLY`, `SSL_REQUIRED`, `CONNECTION_FAILED`, `SSRF_BLOCKED`). Bad input, such as a missing host or `sslMode: disable`, is refused at once with HTTP 400.

`PATCH /v1/connections/{id}` saves a new `label` or `sendSampleRowsToLlm` at once (HTTP 200, the connection). A new host, port, database, username, password, or SSL mode is checked by the worker first (HTTP 202, a job), and is saved only if the check passes.

Changing a connection's host, port, or database name deletes its schema snapshot and allowlist, because it may now be a different database. Refresh the schema afterwards and review the allowlist again. A new password or SSL mode keeps them.

Use host `sample-db` and port `5432` when the worker is the Compose container. `sample_admin` is rejected because it is the owner, and is not stored. `sslMode` must be `require` or `verify-full`. No response includes the password, and a finished job keeps no credentials.

## Read the schema and choose what the AI sees

Read a connection's schema. The first refresh allows every table and every column that does not look sensitive:

```powershell
$refreshed = Wait-AydJob (Invoke-RestMethod "http://localhost:3000/v1/connections/$($conn.id)/schema/refresh" -Method Post -Headers $auth)
$refreshed.result
```

`GET /v1/connections/{id}/schema` returns what the model may see: allowed tables and columns only, plus a `fingerprint`. On the sample database, `customers.email` and `support.tickets.contact_phone` start hidden, and the `finance` schema never appears because `sample_ro` cannot read it.

`GET /v1/connections/{id}/allowlist` lists every table and column with `allowed` and `sensitive` flags. Save changes with `PUT`, naming the snapshot `version` you edited:

```powershell
$allow = '{"version":1,"tables":[{"schema":"public","name":"orders","description":"One row per order","columns":[{"name":"id"},{"name":"status"}]}]}'
Invoke-RestMethod "http://localhost:3000/v1/connections/$($conn.id)/allowlist" -Method Put -ContentType "application/json" -Headers @{ Authorization = "Bearer $($login.accessToken)" } -Body $allow
```

A later refresh keeps your choices, and any new table or column stays hidden until you allow it. A save against an older `version` returns `SCHEMA_CHANGED`.

## Check SQL against the allowlist

The SQL guard decides whether a query is one safe read over allowed tables and columns. It never runs the query. Try it on a connection whose schema has been read:

```powershell
$check = '{"sql":"SELECT * FROM customers"}'
Invoke-RestMethod "http://localhost:3000/v1/connections/$($conn.id)/sql/check" -Method Post -ContentType "application/json" -Headers @{ Authorization = "Bearer $($login.accessToken)" } -Body $check
```

An allowed query comes back with `allowed: true` and the SQL that would run, rewritten with schema names, with `*` replaced by the allowed columns, and with `LIMIT` capped at `SQL_ROW_CAP` (1,000 by default). A rejected one comes back with `allowed: false`, a `code` such as `column_not_allowed` or `not_select`, and a `reason`. Both are HTTP 200. On the sample, `SELECT email FROM customers` and `DELETE FROM customers` are rejected.

## Ask a question

With `GEMINI_API_KEY` in `.env` and the worker running, ask in English. The worker asks the model for SQL over the tables you allowed, checks it with the guard, and runs it:

```powershell
$asked = Wait-AydJob (Invoke-RestMethod "http://localhost:3000/v1/connections/$($conn.id)/questions" -Method Post -ContentType "application/json" -Headers $auth -Body '{"question":"How many orders does each region have?"}')
$asked.result
```

`result.status` is `answered` (with `sql`, `rows`, `assumptions`, a `chart` choice, `facts`, a short `summary`, and `usage` totals), `ambiguous` (with a `clarifyingQuestion`; nothing ran), or `unanswerable` (with an `explanation`; nothing ran). Without a key the job fails with `LLM_NOT_CONFIGURED`.

## History

Every finished question or SQL job is kept in history: what was asked, the SQL that ran, the outcome, the summary, and the cost, never the rows.

```powershell
$page = Invoke-RestMethod "http://localhost:3000/v1/history?limit=20" -Headers $auth
$page.entries | Select-Object createdAt, question, status, rowCount
$again = Wait-AydJob (Invoke-RestMethod "http://localhost:3000/v1/history/$($page.entries[0].id)/rerun" -Method Post -Headers $auth)
```

Pass `nextCursor` back as `cursor` for older entries. Re-run replays the stored SQL through the guard, with no model call. `DELETE /v1/history/{id}` removes one entry and `DELETE /v1/history` removes all.

## Limits and usage

Each user may send 10 questions, queries, or re-runs a minute, and ask 50 questions a day (UTC). Past either limit the API answers 429 with `RATE_LIMITED` or `QUOTA_EXCEEDED` and a `Retry-After` header in seconds. Sign-in and refresh are limited to 20 a minute per IP address. The limits are `SUBMISSIONS_PER_MINUTE`, `QUESTIONS_PER_DAY`, and `AUTH_REQUESTS_PER_MINUTE` in `.env`.

```powershell
Invoke-RestMethod http://localhost:3000/v1/usage -Headers $auth
```

It shows today's questions against the limit, finished questions, rows returned, and tokens.

## Run a query as a job

The API queues the SQL and answers at once with a job (HTTP 202). The worker checks it with the guard, runs it read-only, and stores the outcome for 15 minutes. It needs the worker: `npm run up` starts it, or run `npm run dev:worker` next to `npm run dev`.

```powershell
$job = Invoke-RestMethod "http://localhost:3000/v1/connections/$($conn.id)/queries" -Method Post -ContentType "application/json" -Headers @{ Authorization = "Bearer $($login.accessToken)" } -Body '{"sql":"SELECT region, count(*) FROM customers GROUP BY region"}'
Invoke-RestMethod "http://localhost:3000/v1/jobs/$($job.id)" -Headers @{ Authorization = "Bearer $($login.accessToken)" }
```

`state` goes from `queued` to `running` (with a `stage`) to `succeeded`, with `result.rows`, or `failed`, with `error.code` and `error.message`. Rejected SQL fails with `SQL_REJECTED` and the guard's reason.

Follow a job live instead of polling. The stream sends a `job` event on every change and ends when the job does:

```powershell
curl.exe -N "http://localhost:3000/v1/jobs/$($job.id)/events" -H "Authorization: Bearer $($login.accessToken)"
```

A user may have 3 jobs waiting or running at once (`JOB_MAX_ACTIVE_PER_USER`); a fourth is refused with HTTP 429 `TOO_MANY_JOBS`. A crashed job is retried up to 3 times.

Cancel a job that has not finished. It ends as `cancelled`:

```powershell
Invoke-RestMethod "http://localhost:3000/v1/jobs/$($job.id)/cancel" -Method Post -Headers $auth
```

## Run a query end to end, without the queue

This script runs the whole pipeline in one process against the sample database: connect with `sample_ro` over SSL, read the schema, check the SQL with the guard, run it read-only, and print the rows.

```powershell
npm run try-query --workspace=@ayd/api -- "SELECT region, count(*) FROM customers GROUP BY region"
```

It needs `npm run up:deps`, migrations, and `SAMPLE_DATABASE_URL` in `.env`. It creates a temporary user and deletes it, with its connection and snapshot, before it exits. Rejected SQL prints the guard's reason. The executor's limits are the `EXECUTOR_*` settings in `.env.example`.

Delete the signed-in account with:

```powershell
Invoke-RestMethod http://localhost:3000/v1/users/me -Method Delete -Headers @{ Authorization = "Bearer $($login.accessToken)" }
```

## Local databases

| Service              | Host port | Database | User           | Password             | Role                                |
| -------------------- | --------- | -------- | -------------- | -------------------- | ----------------------------------- |
| Application Postgres | 5434      | `ayd`    | `ayd`          | `ayd`                | accounts, sealed connections, audit |
| Sample Postgres      | 5433      | `sample` | `sample_admin` | `sample_admin`       | owner, local only                   |
| Sample read-only     | 5433      | `sample` | `sample_ro`    | `sample_ro_password` | `SELECT` only                       |
| Redis                | 6379      |          |                |                      | job queue, limits, live job events  |

These passwords are local defaults. They are not production secrets.

Confirm the sample seed:

```powershell
docker compose exec sample-db psql -U sample_admin -d sample -c "SELECT count(*) FROM customers;"
```

The sample is a small retail set: customers, products, orders, order items, and payments in `public`, warehouses and stock in `inventory`, tickets in `support`, and a `finance` schema that `sample_ro` cannot read. It stands in for a customer's database. A volume created before `infra/sample-db/multi-schema.sql` existed can get it with the command at the top of that file. The application never copies those rows into its own database.

## Checks

```powershell
npm run lint
npm run format:check
npm test
npm run build
```

`npm run test:browser` runs the browser tests (Playwright; first run `npx playwright install chromium`) against servers of their own, with a scripted model; `npm run test:browser:live` asks the real model one question. Both build first, which restarts dev servers you have running. `npm test` is the unit suite and does not need Docker. `npm run test:int` and `npm run test:e2e` need the application Postgres and Redis from `npm run up:deps`, after migrations. See [docs/testing.md](docs/testing.md).

CI runs lint, format, unit tests, and build on every push. A second job runs integration and API end-to-end tests against Postgres and Redis.

## Decisions that shape the code

- LLM provider: Google Gemini, behind a provider interface. The platform owns the API key.
- Sign-in: Google OIDC, plus a local-only development login so the app can be used without Google credentials.
- PostgreSQL only in v1. Read-only. Result rows are not stored.

The full list, with reasons, is in the ADRs (`docs/adr/`). Never put a Gemini key or a Google client secret in the repository; they belong in `.env`, which git ignores.
