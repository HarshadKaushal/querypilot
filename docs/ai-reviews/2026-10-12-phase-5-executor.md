# AI review: executor

Date: 2026-10-12
Base commit: `5124703` (feat(api): add the SQL check endpoint and document Phase 4)

## What changed

Phase 5. `QueryExecutor` runs guarded SQL on a user database. ADR 0010 records the design.

- `query-executor.ts`: breaker check, a Redis slot, a pooled socket, `BEGIN READ ONLY`, a statement timeout, an empty search_path, a cursor read 100 rows at a time up to the row and size caps, then `ROLLBACK`. The cursor and fetches go over the extended protocol, which accepts one statement.
- `coordination.ts`: Redis Lua scripts for per-connection slots (lease tokens in a sorted set) and the circuit breaker, with an in-memory version for unit tests.
- `connection-pools.ts`: one `pg.Pool` per user connection, keyed by target, at most `EXECUTOR_MAX_CONCURRENT_QUERIES` sockets, idle sockets closed after 10 s, at most 200 pools. Date and time values come back as PostgreSQL's text.
- `query-error.ts`: SQLSTATE-based failure codes with fixed messages and a `retryable` flag.
- `connection-config.ts`: the socket settings (pinned address, TLS, server name) now shared by the probe and the pools.
- `ConnectionService` closes a connection's pool when its credentials change or it is deleted.
- `RedisService.run` runs Lua scripts. All callers now share one connect attempt.
- Six `EXECUTOR_*` settings, defaults from the Phase 5 choices: 15 s, 5 MB, 2 queries at once, 10 s queue wait, pause after 5 failures for 60 s. Seven new error codes in `@ayd/shared`.

## AI usage

An AI assistant (Claude Code) designed and wrote the executor, the tests, and ADR 0010, and ran the live checks. The developer chose the limits and chose tests plus a live script over an endpoint.

## Suggestions accepted

- Run every query inside `BEGIN READ ONLY` and end with `ROLLBACK`, so a write is impossible at the database even if the guard and the read-only role check both fail.
- Force the extended protocol with `queryMode: 'extended'` so only one statement can run.
- Read through a cursor in batches, so a huge result is never held in memory before the caps apply.
- Keep slots and the breaker in Redis with Lua and Redis time, so limits hold across processes and servers with different clocks.
- Treat only connection failures and timeouts as breaker failures. A query mistake proves the database is up.
- Return dates and times as text, and leave `numeric` and `bigint` as strings.

## Suggestions rejected

- `pg-cursor`. `DECLARE` and `FETCH` do the same job with no new dependency.
- A third socket per pool, from "3 open sockets" in the Phase 5 choices. Slots are global and a socket opens only while a query runs, so it would never be used. ADR 0010 explains this.
- `SET LOCAL TimeZone = 'UTC'`. It would change how `date_trunc` buckets `timestamptz` values, and the customer's database time zone is what their questions mean.
- An HTTP route to run SQL. The developer chose tests and a script, and ADR 0003 keeps execution for the worker.

## Decisions

- Each slot lease lasts the statement timeout plus 10 seconds.
- A full page under a LIMIT the guard added counts as cut (`guardLimitApplied`), because the guard caps at the row cap itself.
- A socket that fails mid-transaction is destroyed, not returned to the pool.

## What was checked

- API unit tests: 201. New: 19 error-mapping cases, 12 executor cases with a fake database (statement order, both caps, guard-limit truncation, a query error discarding the socket and freeing the slot, busy, the breaker opening and resetting, query mistakes not counting), pool reuse, replacement, eviction, and the LRU limit, the date parsers, and eviction from `ConnectionService`.
- Integration tests: 41. New `query-executor.int-spec.ts` (13) on real PostgreSQL and Redis. It checks that the transaction is read-only with an empty search_path, and that dates, timestamps, and numerics come back as text. A login that can write, with no guard in front, had a sequence write, `FOR UPDATE`, a data-modifying WITH, `SELECT 1; COMMIT; DELETE ...`, and an UPDATE all refused, with the table unchanged after each. It also covers a 500 ms timeout, row and size caps, the limit holding across two executor instances (four 0.6 s queries took two rounds), busy, a crashed holder's slot freeing after its lease, and the breaker pausing both instances after failures split between them.
- The integration tests found three defects in this code before the commit, all fixed. First, `values: []` did not force the extended protocol, and `SELECT 1; COMMIT; DELETE FROM public.t` deleted all 50 rows of the test table. Second, concurrent first calls to Redis failed because the second caller did not wait for the first connect. Third, a 5-letter Node code such as `EPIPE` was read as a SQLSTATE.
- All workspaces' unit tests, end-to-end tests, ESLint, Prettier, and the full build pass.

## Still open

- The executor runs in the API process and nothing serves it over HTTP. Phase 6 moves it to the worker.
