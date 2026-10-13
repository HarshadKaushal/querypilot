# Ask Your Database

Middleware that lets a signed-in user connect their own PostgreSQL database and ask questions in plain English. The platform proposes SQL, checks it, runs it read-only, and returns a table, a chart, the SQL, and a short summary.

This repository is in **Phase 6 (queue and worker)**: queries run as worker jobs. The ask pipeline and the web UI are not built yet. See [docs/features.md](docs/features.md).

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

The schema lives in `packages/database`. The container entrypoint runs that migrate command on its own, so `npm run up` does not need this step.

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

Google sign-in is `GET /v1/auth/google/start`. It redirects to Google after you set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. Until those are set, that route returns `AUTH_NOT_CONFIGURED`.

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
| Redis                | 6379      |          |                |                      | queue and cache later               |

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

`npm test` is the unit suite and does not need Docker. `npm run test:int` and `npm run test:e2e` need the application Postgres and Redis from `npm run up:deps`, after migrations. See [docs/testing.md](docs/testing.md).

CI runs lint, format, unit tests, and build on every push. A second job runs integration and API end-to-end tests against Postgres and Redis.

## Layout

```text
apps/api              NestJS HTTP API
apps/worker           NestJS worker process: takes jobs from the queue and runs them
packages/core         Nest modules both processes share: config, logging, Prisma, Redis,
                      connections, schema, SQL check, executor, and the job queue
packages/crypto       Envelope encryption for connection secrets
packages/database     Prisma schema, migrations, and client
packages/shared       Error envelope, request id, health report types
packages/ssrf-guard   Host and address checks for user databases
packages/sql-guard    SQL checks and rewriting, on PostgreSQL's own parser
infra/docker          API and worker images
infra/sample-db       Seed and TLS entrypoint for the sample user database
docs                  Index, blueprint, decisions, and reviews
```

Start with [docs/README.md](docs/README.md). Later phases add `apps/web` and `eval`.

## Decisions already locked for later phases

- LLM provider: Google Gemini, behind a provider interface. The platform owns the API key.
- Sign-in: Google OIDC, plus a local-only development login so the app can be used without Google credentials.
- PostgreSQL only in v1. Read-only. Result rows are not stored.

Those pieces are not in this phase. Do not put a Gemini key or a Google client secret in the repository.
