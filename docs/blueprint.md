# Ask Your Database: Production Build Blueprint

A step-by-step workflow for building a scalable, secure AI analytics assistant. This document contains flow and structure only, with no code. It is written so it can be handed to Cursor (or any engineer) and executed phase by phase.

## 1. Product Summary

**Ask Your Database** is a middleware web application. A user signs in with Google, connects their own PostgreSQL database, and asks business questions in plain English. The system uses an LLM to propose a SQL query, validates it for safety, executes it read-only against the user's database, and returns a table, a chart, the SQL, and a plain-English summary of the results.

**Key principle:** we are a pass-through. We never copy or store the user's business data. We store only: accounts, encrypted connection credentials, filtered schema metadata, and query history (without result rows).

## 2. Locked Decisions


| Topic               | Decision                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Login               | Google Sign-In only (OpenID Connect)                                                                                           |
| Supported databases | PostgreSQL only in v1, behind an adapter interface so others can be added later                                                |
| AI key              | Owned by the platform, never by the user. Users only provide database credentials                                              |
| LLM usage           | Two LLM tasks per question: SQL generation and result summary. Provider is swappable via a provider-agnostic interface         |
| Data sent to LLM    | Allowlisted schema for SQL generation; question, column names, a capped sample of rows and computed statistics for the summary |
| Network             | All outbound connections to user databases leave from one fixed static egress IP, which users allowlist in their firewall      |
| Frontend            | React + TypeScript                                                                                                             |
| Backend             | NestJS + TypeScript, modular monolith with separate API and worker processes                                                   |
| App database        | PostgreSQL (stores app data only)                                                                                              |
| Queue and cache     | Redis                                                                                                                          |




## 3. Architecture Overview

1. **React frontend** served from a CDN.
2. **NestJS API process:** stateless. Handles auth, CRUD, enqueueing jobs, and streaming progress to the client.
3. **NestJS worker process:** same codebase, different entry point. Consumes jobs from the queue and runs the full ask pipeline.
4. **Redis:** job queue, rate limits, global connection semaphores, short-lived caches.
5. **App PostgreSQL** (behind a connection pooler): users, connections, schema snapshots, allowlists, query history, audit log.
6. **LLM provider layer:** abstraction over one or more providers with fallback.
7. **User's PostgreSQL:** reached only by workers, only through the fixed egress IP, only read-only.

**Request shape:** the client submits a question, the API validates and enqueues it and returns a job id immediately, the worker runs the pipeline, and the client receives progress and the final result over Server-Sent Events (with polling as fallback).

## 4. Tech Stack

- **Frontend:** React, TypeScript, Vite, TanStack Query, a charting library (Recharts or similar), a virtualized table component, a component library for responsive UI.
- **Backend:** NestJS, TypeScript, class-validator DTOs, Swagger/OpenAPI, BullMQ, an ORM with migrations (TypeORM or Prisma), the `pg` driver for user databases.
- **SQL parsing:** a real PostgreSQL parser library (AST based), not regular expressions.
- **Auth:** Google OIDC with PKCE, short-lived JWT access tokens, rotating refresh tokens in httpOnly cookies.
- **Crypto:** AES-256-GCM envelope encryption with a KMS or secrets-manager master key.
- **Testing:** Jest for unit and integration, Supertest for API, Testcontainers (or Docker Compose) for real Postgres and Redis, Playwright for end-to-end.
- **Observability:** OpenTelemetry, structured JSON logs, Prometheus-style metrics.
- **Infrastructure:** Docker, Docker Compose for local, CI pipeline, cloud deployment with a NAT gateway and a single elastic IP.



## 5. Repository Structure (Monorepo)

- `apps/api`: NestJS API entry point.
- `apps/worker`: NestJS worker entry point (reuses shared modules).
- `apps/web`: React frontend.
- `packages/shared`: shared types, DTO contracts, enums, error codes.
- `packages/sql-guard`: the SQL validator as a pure, dependency-light library (heavily tested).
- `packages/ssrf-guard`: hostname and IP validation library.
- `infra`: Docker files, Compose, deployment manifests.
- `docs`: README, architecture notes, runbooks, evaluation results.
- `eval`: evaluation dataset and runner.



## 6. Rules for the Implementer (Claude)

1. Follow the build phases in order. Do not start a phase until the previous phase's acceptance criteria pass.
2. Safety components (SQL guard, SSRF guard, crypto) are built **test-first**.
3. The API process must remain **stateless**. No in-memory sessions, no local file state, no in-process rate limits.
4. Anything shared between instances (rate limits, locks, quotas, caches) lives in Redis.
5. Never log credentials, tokens, decrypted secrets, or result rows.
6. Never return raw database or LLM errors to the client. Map them to stable error codes with friendly messages.
7. Every database access on a user connection must go through the Executor module. No other module may open a connection to a user database. (In code: `UserDatabaseModule` in `packages/core/src/user-database/`.)
8. Every record is scoped by `user_id`. Every query by id must also check ownership.
9. Every external call (LLM, user database) has a timeout, a bounded retry policy, and a circuit breaker.
10. Keep modules small with explicit interfaces so a module can later be split into a service without rewriting callers.



## 7. App Database Model

- **users:** id, google subject id (unique), email, name, avatar, plan tier, created and last-login timestamps.
- **refresh_tokens:** id, user, token hash, expiry, revoked flag, device info.
- **connections:** id, user, label, host, port, database name, SSL mode, encrypted username, encrypted password, key version, status (pending, active, failing, disabled), last tested at, setting for sending sample rows to the LLM.
- **schema_snapshots:** id, connection, version number, schema JSON (tables, columns, types, primary keys, foreign keys), created at.
- **allowed_objects:** connection, schema name, table name, optional column name, optional description. This is the approved allowlist.
- **queries:** id, user, connection, question, generated SQL, status, error code, row count, truncated flag, latency per stage, models used, tokens in and out, created at. **No result rows.**
- **query_cache:** key of connection + schema version + normalized question, mapped to the validated SQL proposal. Never stores result rows.
- **usage_counters:** user, day, questions asked, rows returned, tokens used.
- **audit_log:** id, user, event type, metadata, IP, created at.

**Scaling notes:** partition `queries` and `audit_log` by month with a retention policy; index history by user and created time; use keyset pagination, never offset pagination; put a connection pooler in front of this database.

## 8. Core Flows



### 8.1 Sign in with Google

1. User clicks Sign in with Google.
2. Frontend redirects to Google; Google returns an authorization code to the backend callback.
3. Backend exchanges the code, verifies the ID token, and creates or updates the user by Google subject id.
4. Backend issues a short-lived access token and a rotating refresh token (httpOnly, Secure, SameSite cookie).
5. Every later request passes through an auth guard; refresh rotation detects reuse and revokes the token family.
6. Logout revokes the refresh token. Account deletion removes all connections, schema data and history, and writes an audit entry.



### 8.2 Connect a database

1. The connect screen shows the platform's **static egress IP** with copy-ready instructions: allow this IP in your firewall and `pg_hba.conf`, require SSL, and create a dedicated read-only role (provide a ready-to-copy setup script in the UI text).
2. User submits host, port, database, username, password and SSL mode.
3. **SSRF guard:** resolve the hostname; reject loopback, private ranges, link-local and cloud-metadata addresses; pin the resolved IP for the actual connection to prevent DNS rebinding; restrict allowed ports if desired.
4. Test the connection with a short timeout. Require SSL (reject plaintext).
5. **Read-only verification:** reject the credentials if the role is a superuser, can create objects, or holds INSERT, UPDATE, DELETE, TRUNCATE or DDL privileges on any object. Show a clear message explaining how to fix it.
6. Introspect the schema (tables, views, columns, types, keys, foreign keys), excluding system schemas.
7. **Allowlist selection:** the user picks which tables and columns the AI may see. Offer a sensitive-column hint (emails, phone numbers, tokens, national IDs) with a default of hidden. Allow optional human descriptions for tables and columns to improve accuracy.
8. Encrypt credentials with envelope encryption and store only ciphertext plus key version.
9. Store the filtered schema snapshot. Provide a Refresh schema action that creates a new version and invalidates cached SQL proposals for that connection.
10. Write audit entries for create, update, test and delete.



### 8.3 Ask a question

1. User picks a connection and types a question.
2. API checks authentication, ownership, per-user rate limit and the connection's health, then **enqueues a job** and returns a job id.
3. Frontend opens a progress stream for the job.
4. Worker runs the pipeline in section 9.
5. Frontend renders the table, chart, summary and SQL, with states for loading, ambiguous, rejected, failed and empty results.
6. The result is recorded in history. The history record holds metadata only.



### 8.4 History

- List past questions with status, latency and timestamp, using keyset pagination.
- Open a past entry to view the generated SQL and summary.
- Re-run a past question (executes again; result rows are not stored).
- Delete an entry or all history.



## 9. Ask Pipeline (Worker)

1. **Load context:** fetch the connection, decrypt credentials in memory only, load the latest allowlisted schema snapshot.
2. **Cache check:** look up a validated SQL proposal for the same connection, schema version and normalized question.
3. **Prompt assembly:** build the prompt from the allowlisted schema only, including keys, foreign keys, descriptions and a few example question-to-SQL pairs. For large schemas, retrieve only the tables relevant to the question (keyword or embedding match) to keep prompts small.
4. **LLM call 1, SQL proposal:** request a structured output with a status (ok, ambiguous, unanswerable), the SQL, the assumptions made, and a clarifying question when ambiguous. If the status is ambiguous or unanswerable, stop and return the explanation to the user. Nothing is executed.
5. **Validation (SQL guard):** see section 10. If it fails, feed a sanitized reason back to the LLM and retry. **Maximum 2 retries.** After that, return a safe failure message.
6. **Execution:** acquire the global per-connection concurrency slot, open a pooled connection, start a READ ONLY transaction, apply a statement timeout, stream rows through a cursor up to the row cap, and enforce a response size cap. Mark the result truncated if capped.
7. **Execution error handling:** map database errors to stable codes. A semantic error (for example an unknown column) may feed one more retry. Timeouts and permission errors do not retry.
8. **Visualization selection:** apply deterministic rules based on column types and cardinality (time series to line, category plus number to bar, small share-of-total to pie, single value to a stat card, otherwise table only). Downsample chart data to a bounded number of points.
9. **LLM call 2, grounded summary:** send the question, column names, a capped sample of rows and server-computed facts (total row count, truncation flag, totals, minimum, maximum, top items). Instruct the model to use only the supplied data and to state when the result was truncated. Optionally verify that every number in the summary appears in the supplied data or statistics, and fall back to a templated summary if not.
10. **Persist:** save the query record, per-stage latency, models and token counts. Cache the validated SQL proposal. Do not store rows.
11. **Emit final result** to the progress stream.



## 10. SQL Safety Rules (SQL Guard)

The guard is a pure function: SQL text plus the allowlist in, a verdict plus a normalized SQL out. It must never touch the network.

**Reject when:**

- the text cannot be parsed, or contains more than one statement;
- the statement is not a plain SELECT (a WITH clause that ends in SELECT is allowed; data-modifying CTEs are not);
- it contains INSERT, UPDATE, DELETE, MERGE, TRUNCATE, any DDL, COPY, SELECT INTO, locking clauses, DO blocks, or transaction control;
- it references any table, view or column not on the allowlist (check the AST, including subqueries, CTEs, joins and aliases);
- it references system catalogs or other schemas not on the allowlist;
- it calls dangerous or side-effecting functions (file access, large objects, remote connections, sleep, advisory locks, configuration setters, and any function not on an approved function list);
- it uses set-returning tricks or recursion that can run unbounded without a limit.

**Always apply:** a maximum LIMIT (inject or lower to the cap), and a normalized form used for caching and logging.

**Defense in depth** (the guard is never the only layer): READ ONLY transaction, statement timeout, row and size caps, read-only role verification at connect time, and per-connection concurrency limits.

## 11. Backend Modules


| Module        | Responsibility                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Auth          | Google OIDC, JWT, refresh rotation, guards                                                                               |
| Users         | Profile, plan tier, account deletion                                                                                     |
| Connections   | Create, test, update, delete; SSRF guard; read-only verification                                                         |
| Crypto        | Envelope encryption, key versioning, rotation job                                                                        |
| Schema        | Introspection, snapshots, allowlist management, schema retrieval for prompts                                             |
| LLM           | Provider interface, adapters, structured output, fallback chain, retries, token accounting                               |
| SqlGuard      | Wrapper around the sql-guard package                                                                                     |
| Executor      | Only gateway to user databases: pooling, global semaphores, read-only transactions, timeouts, row caps, circuit breakers |
| Query         | Orchestrates the pipeline; owns the job lifecycle                                                                        |
| Visualization | Chart-type selection and downsampling                                                                                    |
| Summary       | Builds summary input, statistics and the grounding check                                                                 |
| History       | Query log, filters, re-run, deletion                                                                                     |
| Quota         | Per-user rate limits and daily counters in Redis                                                                         |
| Audit         | Security and lifecycle events                                                                                            |
| Health        | Liveness and readiness (app DB, Redis, queue, LLM reachability)                                                          |




## 12. API Surface

All endpoints are versioned, validated with DTOs, documented in Swagger, and protected by the auth guard unless noted.

- **Auth:** start Google login, callback, refresh, logout, current user.
- **Connections:** create, list, get, test, update, delete.
- **Schema:** get schema, refresh schema, get and update allowlist.
- **Query:** submit question (returns job id), get job status and result, progress stream (SSE), cancel job.
- **History:** list (keyset paginated), get, re-run, delete one, delete all.
- **Usage:** current usage and limits.
- **Meta:** platform egress IP and setup instructions (public).
- **Health:** liveness and readiness (public).

Standard error envelope everywhere: a stable error code, a friendly message, and a request id.

## 13. Scalability Design

1. **Stateless API:** add instances freely behind a load balancer. Sessions are tokens, not memory.
2. **Queue-based execution:** slow LLM calls and slow user databases never block API threads. Autoscale workers on **queue depth and wait time**, not CPU.
3. **Fair scheduling:** per-user job grouping so one heavy user cannot starve others. Cap concurrent jobs per user.
4. **Global connection control:** a Redis semaphore limits open connections and concurrent queries **per user connection across all workers** (for example 2 to 3 connections and 2 concurrent queries). Pool entries are evicted by LRU with a short idle timeout and closed on credential change or deletion.
5. **Circuit breakers:** one per user connection (repeated failures pause that connection with a clear message) and one per LLM provider (automatic fallback to the next provider).
6. **Fixed egress IP with many instances:** place all workers in a private subnet behind one NAT gateway with one elastic IP. Never assign public IPs to individual workers. For later multi-region needs, introduce small regional egress proxies.
7. **Streaming results:** use database cursors and caps; never load a full result set into memory.
8. **Caching:** validated SQL proposals (keyed by connection, schema version and normalized question), schema snapshots, and decrypted credentials only in worker memory with a short TTL.
9. **App database:** connection pooler, monthly partitions for logs, retention policies, indexes for history, read replica when history and analytics load grows.
10. **Redis:** persistence enabled for queues; separate logical databases or instances for queue versus cache when load grows.
11. **Module boundaries:** the LLM and Executor modules have narrow interfaces so they can be extracted into services later if needed. Do not split prematurely.
12. **Frontend:** static assets on a CDN, virtualized tables, server-side pagination, chart downsampling, query caching on the client.

**Rollout stages:** Stage 1 (up to about 100 users): one API instance, one worker, managed Postgres and Redis. Stage 2 (up to about 1,000): multiple API instances, autoscaled workers, pooler, partitioned logs. Stage 3 (beyond): read replica, regional egress proxies, semantic caching, optional service extraction.

## 14. Security Requirements

- Encrypt connection credentials with envelope encryption; support key rotation by re-wrapping data keys in a background job without downtime.
- Require SSL for all user database connections.
- SSRF protection on every connect and test, including DNS pinning.
- Treat schema comments, column names and cell values as **untrusted input** (prompt injection). Safety must come from validation and database controls, never from prompt wording.
- HTTPS only, strict CORS, security headers, CSRF protection for cookie flows, input validation on every endpoint.
- Rate limit by user and by IP in Redis, with stricter limits on login, connection test and query endpoints.
- Authorization tests prove that a user can never read, test, query or delete another user's connection or history.
- Secrets only in a secrets manager or environment, never in the repository. Provide an environment-variable example file.
- Complete audit trail for logins, connection changes, rejected queries and account deletion.
- Provide account deletion and data export for privacy compliance.



## 15. Observability

- **Tracing** across API, queue, worker, LLM and user database, with a request id and job id propagated everywhere.
- **Metrics:** queue depth and wait time, per-stage latency (p50 and p95), LLM success, fallback and error rates, validator rejection rate and reasons, per-connection timeout and failure rates, cache hit rate, active connections.
- **Alerts:** growing queue backlog, high LLM failure or fallback rate, spike in rejected SQL (possible abuse), rising connection failures, error-rate increase.
- **Logs:** structured JSON with no secrets and no rows.
- **Dashboards:** one for system health, one for query quality and safety.



## 16. Frontend Specification

**Screens:** sign in, connections list, connect-a-database wizard (shows egress IP, then credentials, then allowlist selection), ask screen, history, usage and settings.

**Ask screen components:** question input with example prompts drawn from the schema, live progress indicator, results table (virtualized, sortable), chart with type switcher, summary panel, collapsible generated SQL with copy button and assumptions list, clarification prompt for ambiguous questions, clear rejected-query message explaining why it was not run.

**States to design explicitly:** loading, streaming progress, empty result, truncated result, ambiguous, unanswerable, rejected for safety, timeout, connection down, quota or rate limited, and generic failure. All must be responsive and accessible.

## 17. Testing and Evaluation

**Unit tests**

- SQL guard: a large corpus of safe queries and attack strings (multi-statement, comments hiding statements, write CTEs, dangerous functions, unapproved tables, aliasing tricks, case and quoting tricks, system catalog access).
- SSRF guard: private and metadata addresses, IPv6 forms, DNS rebinding simulation.
- Crypto: round trip, tamper detection, key rotation.
- Visualization rules and summary grounding check.

**Integration tests** (real Postgres and Redis containers)

- Full pipeline with a mocked LLM and a seeded sample database.
- Executor: timeout, row cap, read-only enforcement, semaphore limits.
- Authorization: cross-user access always denied.
- Failure scenarios: LLM down, LLM returns malformed output, user database unreachable, bad credentials, query timeout, queue worker crash and job retry.

**End-to-end tests** (Playwright)

- Sign in, connect, ask a question, see table and chart, see an ambiguous request, see a rejected unsafe request.

**Evaluation dataset**

- A seeded sample business database (for example orders, customers, products, payments) with 40 to 60 questions of increasing difficulty, each with a reference SQL or reference answer.
- Include ambiguous questions (expected: clarification), unanswerable questions (expected: refusal), and unsafe requests (expected: rejection).
- Metrics: execution accuracy, result-match accuracy, safe-rejection rate for unsafe prompts, correct-clarification rate, average latency, retry rate.
- Run the same set against each candidate LLM and record results in the docs. Use the results to choose the primary and fallback models.
- Rerun on every prompt or model change as a regression gate in CI.

**Load tests:** simulate many users and a slow user database to confirm queue fairness, connection limits and autoscaling behavior.

## 18. Build Phases

Each phase lists tasks and acceptance criteria. Do not advance until acceptance passes.

### Phase 0: Foundation

**Tasks:** create the monorepo, linting, formatting, CI pipeline, Docker Compose with app Postgres, Redis and a seeded sample Postgres to act as a user database, configuration module with validated environment variables, structured logging, health endpoint, migration setup, base error envelope and request id. **Acceptance:** one command starts everything locally; CI runs lint and tests; health endpoint reports dependencies.

### Phase 1: Authentication and Users

**Tasks:** Google OIDC flow, JWT and rotating refresh tokens, guards, users table, logout, account deletion skeleton, audit logging. **Acceptance:** sign in and out works end to end; refresh reuse is detected; unauthenticated calls are rejected; tests cover auth failures.

### Phase 2: Crypto, Connections and SSRF Guard

**Tasks:** envelope encryption with key versioning, SSRF guard package, connection create, test, update and delete, SSL requirement, read-only role verification, egress IP meta endpoint. **Acceptance:** credentials are never stored or logged in plaintext; private and metadata addresses are rejected; superuser and write-capable roles are rejected with helpful messages; ownership enforced.

### Phase 3: Schema Introspection and Allowlist

**Tasks:** introspection, snapshot versioning, allowlist and sensitive-column defaults, descriptions, refresh with cache invalidation. **Acceptance:** only allowlisted objects appear in any schema output; refresh creates a new version; tests with a multi-schema sample database pass.

### Phase 4: SQL Guard (test-first)

**Tasks:** build the guard as an isolated package, implement all reject rules and limit injection, write the attack corpus first. **Acceptance:** every attack string is rejected; every safe query passes; the package has no network or database dependency; coverage is near complete on rules.

### Phase 5: Executor

**Tasks:** pooled connections, READ ONLY transactions, statement timeout, cursor-based row cap, size cap, global Redis semaphores, per-connection circuit breaker, error mapping. **Acceptance:** write attempts fail even if the guard is bypassed in a test; timeouts and caps work; concurrency limits hold across multiple worker instances; no raw errors leak.

### Phase 6: Queue, Worker and Progress Streaming

**Tasks:** BullMQ queue, separate worker entry point, job lifecycle and states, SSE progress stream, cancellation, retry and dead-letter policy, per-user fair scheduling and job caps. **Acceptance:** the API returns immediately with a job id; progress streams correctly; a crashed worker's job is retried safely; one user cannot starve others.

### Phase 7: LLM Layer and Ask Pipeline

**Tasks:** provider interface, adapters and fallback chain, structured output for SQL proposals, prompt assembly with schema retrieval, bounded retries, caching of validated proposals, visualization selection, grounded summary with verification, token and latency accounting. **Acceptance:** the full pipeline runs against the sample database; ambiguous and unanswerable questions stop before execution; malformed model output is handled; provider failure triggers fallback.

### Phase 8: History, Quotas and Audit

**Tasks:** history endpoints with keyset pagination, re-run and delete, Redis rate limits and daily counters, usage endpoint, audit coverage. **Acceptance:** history never contains result rows; rate limits work across instances; audit entries exist for all sensitive actions.

### Phase 9: Frontend

**Tasks:** all screens in section 16, SSE handling with reconnect, virtualized table, charts, every defined state, responsive layout, accessibility pass. **Acceptance:** the demo flow works on desktop and mobile widths; every error and edge state has a designed message.

### Phase 10: Observability and Hardening

**Tasks:** tracing, metrics, dashboards, alerts, security headers, CORS, CSRF, penetration-style review of the validator and SSRF guard, dependency audit. **Acceptance:** a single request is traceable end to end; alerts fire in a simulated failure; security checklist signed off.

### Phase 11: Evaluation and Load Testing

**Tasks:** build the evaluation dataset and runner, compare candidate models, record results, add the CI regression gate, run load tests. **Acceptance:** evaluation report exists with accuracy and safety numbers; chosen models are justified by data; load test results documented.

### Phase 12: Deployment and Documentation

**Tasks:** production Docker images, infrastructure with private subnet, NAT gateway and elastic IP, managed Postgres and Redis, secrets management, migrations in the release process, autoscaling rules, backup and restore, runbook, README, environment example file, API documentation. **Acceptance:** a fresh environment can be deployed from the README; the published egress IP matches what the UI shows; rollback and backup restore are tested.

## 19. Definition of Done

- A new user can sign in with Google, connect a read-only Postgres database, restrict what the AI can see, and ask questions.
- Successful questions return a table, a suitable chart, the SQL and an accurate summary.
- Ambiguous requests produce a clarifying question; unanswerable requests are explained.
- Unsafe SQL is rejected before execution, and writes are also blocked at the database layer.
- No credentials, rows or secrets appear in logs; no result rows are stored.
- Tests (unit, integration, end-to-end) pass in CI; the evaluation report is published.
- The system scales horizontally: more API instances and more workers require no code change.



## 20. Demo Script

1. Sign in with Google and connect the sample database via the wizard, showing the egress IP step and the allowlist.
2. Ask a clear question (for example top customers by revenue last quarter) and show the table, the chart, the summary and the generated SQL.
3. Ask an ambiguous question (for example "how are sales doing?") and show the clarifying question.
4. Ask for something unsafe (for example "delete all inactive customers") and show the rejection with the reason.
5. Open history to show status, latency and model usage.
6. Show the evaluation report and the dashboard.



## 21. Out of Scope for v1

Databases other than PostgreSQL, SSH tunnels, per-tenant egress IPs, team workspaces and role sharing, scheduled reports, write access of any kind, storing or caching result rows, and custom model fine-tuning. The architecture leaves room for each without rewrites.