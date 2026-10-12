# AI review: SQL check endpoint and Phase 4 docs

Date: 2026-10-12
Base commit: `19332fc` (feat(sql-guard): add the SQL guard package, built test-first)

## What changed

Second and last commit of Phase 4.

- `POST /v1/connections/:id/sql/check` with `{ "sql": "..." }` runs the guard against the connection's latest allowlist and returns `{ allowed: true, sql, limitApplied, rowCap, schemaVersion }` or `{ allowed: false, code, reason, schemaVersion }`, both as HTTP 200. It never runs the SQL.
- `SqlGuardModule` and `SqlGuardService` (the blueprint's SqlGuard module) wrap `@ayd/sql-guard`. `SchemaModule` now exports `SchemaService`.
- New setting `SQL_ROW_CAP`, 1 to 10,000, default 1,000.
- The API depends on `@ayd/sql-guard`. The root build and test scripts, the API's unit-test script, and both Dockerfiles build or copy the package.
- README, features, business domain, and implementation docs describe Phase 4.

## AI usage

An AI assistant (Claude Code) wrote the module, the route, the tests, and the doc changes, and ran the live checks. The developer asked for the check endpoint and the 1,000-row cap.

## Suggestions accepted

- A rejection is a 200 response with `allowed: false`, because the check itself succeeded. HTTP errors stay for a missing schema (409), someone else's connection (404), and a body without text SQL (400).
- Build the guard's table list from the allowlist editor view, which already holds every table and column with its allowed flag, and checks ownership and that a snapshot exists.
- Run the rewritten SQL by hand as `sample_ro`, in a read-only transaction with an empty `search_path`, to show what the guard returns is valid PostgreSQL under the executor rules in ADR 0009.

## Suggestions rejected

- Writing an audit row for every check. A check runs nothing, and an editor might call it on every keystroke. Rejected queries in the ask pipeline will be audited in the history and audit phase.
- A separate request-body length limit. The guard already refuses SQL over 20,000 characters with `too_long`.

## Decisions

- The response includes `schemaVersion`, so a caller can tell which snapshot the verdict was made against.
- The row cap is a deployment setting, not per user or per connection. The blueprint does not ask for more yet.

## What was checked

- API unit tests: 169. `sql-guard.http.spec.ts` (7): sign-in required, `SCHEMA_NOT_READY` before a refresh, an allowed `SELECT *` returned expanded and capped at the configured 50, a hidden column rejected with its reason, an allowlist edit taking effect, a non-text `sql` rejected, and another user's connection as 404.
- All workspaces' unit tests (including the guard's 309), integration (28), end-to-end (3), ESLint, Prettier, and the full build pass.
- Live, compiled API against the sample database: a revenue-by-customer join and an inventory join were allowed and returned qualified. `SELECT *` on `customers` and `support.tickets` came back without `email`, `contact_phone`, or `name`. Hidden columns, `finance.payroll`, `DELETE`, a stacked `DROP TABLE`, and `pg_sleep` were each rejected with the right code. The check account was deleted afterwards.
- The four allowed outputs ran as `sample_ro` inside `BEGIN READ ONLY` with `SET LOCAL search_path = ''` and returned the expected rows.

## Still open

- Nothing executes guarded SQL yet. Phase 5 builds the executor: pooled connections, READ ONLY transactions, statement timeouts, its own row cap, Redis semaphores, and an empty `search_path`.
