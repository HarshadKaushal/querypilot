# Feature Documentation

Status of Ask Your Database against the production blueprint. Phase 5 (the executor) is the current milestone.

## Completed

- npm workspace with `apps/api`, `apps/worker`, `packages/shared`, `packages/database`, `packages/crypto`, and `packages/ssrf-guard`.
- ESLint, Prettier, and a GitHub Actions workflow that runs lint, format check, unit tests, and build.
- Docker Compose for the application Postgres, Redis (AOF enabled), and a seeded sample Postgres.
- Docker images and process entrypoints for the API and the worker.
- Environment validation for the API (including the master-key ring and `SSRF_ALLOW_PRIVATE`) and the worker (`NODE_ENV`, `LOG_LEVEL`, `REDIS_URL`). `SSRF_ALLOW_PRIVATE` cannot be true in production.
- Structured JSON logs with redaction of credential-like fields and database URLs inside error messages.
- `x-request-id` on responses, reused when the client sends a safe value.
- Error envelope for 404, application errors, and unexpected failures. Unexpected messages are replaced with a fixed sentence.
- Prisma schema and migrations in `packages/database`. The API container runs `prisma migrate deploy` from that package on startup.
- Liveness at `GET /health/live`.
- Readiness at `GET /health/ready`, covering the application database and Redis.
- Sample retail schema (customers, products, orders, order items, payments) and a read-only login, `sample_ro`.
- Root `README.md` with setup and run instructions.
- `.env.example` with local URLs and no third-party secrets.
- Google OIDC start and callback with PKCE. The ID token is verified against Google's certificates. Unverified emails are rejected.
- Local development login at `POST /v1/auth/dev/login`, enabled only when `DEV_LOGIN_ENABLED=true` and `NODE_ENV` is not `production`.
- Short-lived HS256 access tokens and rotating refresh tokens. The refresh token is stored as a hash and returned only in an httpOnly cookie.
- Refresh reuse revokes the token family. Logout revokes the presented token. `GET /v1/users/me` rejects missing or invalid access tokens.
- Account deletion removes the user and refresh tokens and writes an audit row. Connections, schema snapshots, and allowlist rows are removed by foreign keys with `ON DELETE CASCADE`. Query history is not stored yet.
- Envelope encryption in `@ayd/crypto`. A random data key encrypts the username and password. The current master key wraps that data key. `rewrapCredentials` rotates only the wrap.
- SSRF checks in `@ayd/ssrf-guard`. Metadata, unspecified, and link-local addresses are always rejected. Loopback and private ranges are rejected unless `SSRF_ALLOW_PRIVATE` is on, which production refuses. The hostname `localhost` follows that same switch. A mixed public and private answer is rejected.
- Connection create, list, get, test, update, and delete under `/v1/connections`. Rows are scoped by `user_id`. Another user's id is `404`.
- SSL modes `require` and `verify-full` only. `disable`, `allow`, and `prefer` are `SSL_REQUIRED`.
- Read-only probe in the executor module (`src/user-database/`). Superuser, write grants, table ownership, and schema `CREATE` are `NOT_READ_ONLY` with a fixed message. Write grants and ownership count when they come through a group role or PUBLIC. The probe is the only code that opens a user database.
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

## Partial

- **Worker.** The process starts, pings Redis, and exits if Redis is down. It does not consume jobs, stream progress, or run the ask pipeline.
- **Shared package.** It holds the error envelope, request id, and health report types. It does not yet hold API DTOs for questions, connections, or history.
- **Observability.** Logs are structured. There are no traces, metrics, dashboards, or alerts.
- **API surface.** Health stays unversioned. Auth and the current user live under `/v1`. There is still no Swagger document.
- **Audit log.** Login, logout, refresh reuse, account deletion, connection create, update, test, and delete, schema refreshes, and allowlist edits are recorded. Rejected queries are a later phase.
- **Account deletion.** The user row, refresh tokens, connections, snapshots, and allowlists go away. Query history is not stored yet.
- **Executor.** It tests connections, reads schemas, and runs guarded SQL: a READ ONLY transaction, a statement timeout (15 s), an empty `search_path`, a cursor read up to 1,000 rows and 5 MB, then `ROLLBACK`. One statement only, through the extended protocol. Two queries at once per connection across all processes, through Redis slots. A connection pauses for 60 s after 5 connection failures or timeouts in a row. There is one pool per connection, closed when credentials change or the connection is deleted. Errors map to fixed messages with a `retryable` flag. It runs in the API process with no HTTP route; `npm run try-query` runs the pipeline by hand, and Phase 6 moves it to the worker.
- **SQL cache invalidation.** The schema fingerprint is ready to key the SQL proposal cache, which arrives with the LLM phase.

## Pending

Locked choices that are not implemented:

- When a query returns `QUERY_SCHEMA_CHANGED`, refresh the schema and retry once against the new snapshot (Phase 7). New objects stay hidden until allowed, so this cannot widen access.
- Show how old the schema snapshot is, or refresh it on a schedule (Phase 8 or 9).
- Gemini as the platform LLM, behind a provider interface, with a second call for the summary.
- Queue, SSE progress, cancellation, and fair scheduling.
- History and quotas. Login rate limits are part of the quota phase.
- React UI (sign-in, connect, ask, history, usage, settings) and every result state.
- Evaluation dataset, load tests, and production deployment (NAT gateway, fixed egress IP, secrets manager).

Out of scope for v1, from the blueprint: databases other than PostgreSQL, SSH tunnels, per-tenant egress IPs, team workspaces, scheduled reports, write access, stored result rows, and custom model fine-tuning.
