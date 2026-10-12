# AI review: reset the schema when a connection moves, name schema drift, widen the setup SQL

Date: 2026-10-12
Base commit: `16ac336` (docs: record the dependency advisories accepted for now)

One commit for related fixes about schemas being out of date or incomplete.

## What changed

1. **A connection pointed at another database.** Editing the host, port, or database name kept the old snapshot and allowlist, so the guard would have checked queries against the wrong database's tables and applied allowlist choices made for a different database. `ConnectionService.update` now passes `resetSchema` when one of those three changes. `PrismaConnectionRepository.update` then deletes the snapshots and allowlist rows in the same transaction as the edit. The audit row records `schemaReset: "true"`. The schema reports `SCHEMA_NOT_READY` until the next refresh, which starts over with the first-snapshot defaults, as for a new connection. A password, username, or SSL change keeps them.
2. **A refresh running while the connection moves.** `commitSnapshot` takes the host, port, and database name the snapshot was read from, compares them with the connection row under the row lock it already took, and stores nothing on a mismatch. The refresh returns `SCHEMA_CHANGED` (409).
3. **Schema drift in a query.** SQLSTATE `42703` (column), `42P01` (table), and `3F000` (schema) now return `QUERY_SCHEMA_CHANGED`, not retryable, with a message to refresh the schema, instead of the generic `QUERY_INVALID`.

4. **Setup SQL shown to customers** (`GET /v1/meta/egress`). It granted access to the `public` schema only, so tables in other schemas never reached the snapshot. It now has commented lines to repeat for each schema the assistant should read. Its `ALTER DEFAULT PRIVILEGES` also covered only tables created by the role running it, so tables the customer's application created later were not readable. It now uses `FOR ROLE <table_owner_role>` and says to name the role the application creates tables as.

## AI usage

An AI assistant (Claude Code) found the first gap while answering the developer's question about when snapshots refresh, and the third while answering what happens when the customer's database changes. It proposed the fixes and wrote the code, tests, and docs. It found the two setup SQL gaps while explaining that SQL to the developer. The developer chose: clear on host, port, or database change, apply the defaults on the next refresh (option A), add `QUERY_SCHEMA_CHANGED`, plan the automatic refresh-and-retry for Phase 7, and plan a staleness hint for later.

## Suggestions accepted

- Delete in the same transaction as the edit, so the connection never points at one database while holding another's allowlist.
- Put the reset in the connection repository. The schema module already depends on the connections module, so the reverse call would be circular.
- Guard the commit by comparing the connection row under the existing lock, with no new column or migration.
- Count only host, port, and database name as a different database.

- Prove the setup SQL with an integration test that runs it as a customer would, rather than only checking its text.

## Suggestions rejected

- Refreshing automatically on create or edit. On its own it would apply first-snapshot defaults to a new database without a review. It is not part of this commit.
- Starting with nothing allowed after a reset (option B). The developer chose behavior consistent with new connections.
- Retrying a `QUERY_SCHEMA_CHANGED` query with the same snapshot. It would fail the same way. Phase 7 refreshes first.
- Returning the setup instructions as numbered steps for the UI. No UI exists yet. That can come with Phase 9.

## Decisions

- A username change keeps the schema. A login with fewer grants makes queries fail safely, and new objects stay hidden until allowed.
- `QUERY_SCHEMA_CHANGED` resets the circuit breaker's count, because it proves the database is reachable.

## What was checked

- API unit tests: 208. New: a database, port, or host change resets and is audited, and a password, username, SSL, or label change does not. A refresh whose connection moved returns `SCHEMA_CHANGED` and stores nothing. Error-mapping cases for `42703`, `42P01`, `3F000`, and an operator error that stays `QUERY_INVALID`.
- Integration tests: 45. New: moving a real connection to a second scratch database deletes its 5 snapshots and its allowlist, the schema then reports `SCHEMA_NOT_READY`, and the next refresh is version 1 with defaults. A commit for a database the connection no longer names returns `stale` and stores nothing. The executor reports a missing column as `QUERY_SCHEMA_CHANGED`.
- The move test was run against the previous `ConnectionService`: it failed with 5 snapshots left. A first attempt to show this ran the test alone, which skipped the tests that create the data, so it failed on its precondition instead. The whole file was run for the real comparison.
- `setup-sql.int-spec.ts` runs the setup SQL on a scratch database with the placeholders filled in and the other-schema lines switched on. The login it creates passes the read-only probe and can read `public`, a second schema, and a table the owner role created after the setup, but cannot insert. The same test against the previous SQL failed on exactly the two gaps: the second schema and the later table were not readable.
- All workspaces' unit tests, end-to-end tests, ESLint, Prettier, and the build pass.

## Still open

- Refresh and retry automatically on `QUERY_SCHEMA_CHANGED` (Phase 7).
- A schema-age hint or scheduled refresh (Phase 8 or 9).
