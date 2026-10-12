# ADR 0010: Executor

`QueryExecutor` is the only code that runs SQL on a user database (blueprint rule 7). It lives with the read-only probe, schema introspection, and the connection pools in `apps/api/src/user-database/`, the blueprint's Executor module. It takes SQL the guard accepted and treats the guard as one layer among several, not the only one.

**One query, step by step.**

1. If the connection is paused by its circuit breaker, refuse with `CONNECTION_PAUSED` without connecting.
2. Take one of the connection's slots in Redis. With none free within `EXECUTOR_QUEUE_WAIT_MS`, answer `CONNECTION_BUSY`.
3. Borrow a socket from the connection's pool.
4. `BEGIN READ ONLY`, `SET LOCAL statement_timeout`, and `SET LOCAL search_path = ''`. The empty search_path makes the function, type, and operator names the guard approved resolve in `pg_catalog` (ADR 0009).
5. `DECLARE` a cursor over the SQL and `FETCH` 100 rows at a time, up to the row cap plus one and the size cap.
6. `ROLLBACK`. Nothing is ever committed.

**One statement only.** The cursor and the fetches are sent with pg's `queryMode: 'extended'`. PostgreSQL's extended protocol accepts exactly one statement, so `SELECT 1; COMMIT; DELETE ...` cannot leave the read-only transaction even if the guard were bypassed. An empty `values` array is not enough: pg then falls back to the simple protocol, which runs several statements. An integration test showed exactly that before the fix.

**Shared limits.** Slots are a Redis sorted set of lease tokens per connection, changed by Lua scripts so taking a slot is atomic across processes. Time comes from Redis, not from each server. A lease lasts the statement timeout plus 10 seconds, so a process that crashes holding a slot loses it on its own. The breaker counts consecutive connection failures and timeouts in Redis. At `EXECUTOR_BREAKER_FAILURES` it pauses the connection for `EXECUTOR_BREAKER_COOLDOWN_MS`, for every process at once. A mistake in the query (a syntax error, say) or a schema change is not a connection failure and resets the count.

**Pools.** There is one `pg.Pool` per user connection, keyed by a hash of the pinned address, credentials, and TLS settings, so new credentials get a new pool. `ConnectionService` closes a pool when its connection's credentials change or it is deleted. Each pool holds at most `EXECUTOR_MAX_CONCURRENT_QUERIES` sockets, closes idle ones after 10 seconds, and at most 200 pools are kept (least recently used first out). The limits chosen for Phase 5 said "2 queries at once (3 open sockets)". Because slots are global and a pool opens a socket only while it runs a query, a third socket per process would never be used, so the pool size equals the query limit.

**Results.** Rows come back as arrays in column order, with column names and type OIDs. Dates, times, timestamps, and intervals come back as the text PostgreSQL writes. pg would otherwise turn a `date` into a JavaScript Date at local midnight, which shows the previous day once serialized in UTC on a server east of Greenwich. `numeric` and `bigint` stay strings, as pg returns them, so no precision is lost. `truncated` says whether the row cap or the size cap cut the result.

**Errors.** Failures are decided from the SQLSTATE and Node's codes, never from database text, and come back as fixed messages. A column, table, or schema the database no longer has (SQLSTATE `42703`, `42P01`, `3F000`) returns `QUERY_SCHEMA_CHANGED`. The guard checked those names against the saved snapshot, so the database changed after the last refresh, and the message says to refresh. It is not retryable, because the same snapshot would fail the same way. `retryable` is true only for other mistakes in the query itself (SQLSTATE classes 42, 22, 21, 0A), which the model may try once more to fix. Timeouts and permission errors are not retryable, as the blueprint asks.

**Where it runs.** In the API process for now, like the probe and introspection, with no HTTP route. Phase 6 moves the executor, with config, logging, Redis, and crypto, into `packages/core` for the worker (ADR 0006). Until then `apps/api/scripts/try-query.cjs` runs the whole pipeline by hand against the sample database.
