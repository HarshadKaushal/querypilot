# AI review: introspect the schema a read-only login can see

Date: 2026-10-12
Base commit: `8f1da3a` (feat(schema): add the snapshot document type and sensitive-column hint)

## What changed

Third slice of Phase 3.

- `executor/schema-introspection.ts` reads relations, columns, primary keys, and foreign keys from `pg_catalog` and builds a `SchemaDocument`. It keeps only what the login can SELECT in schemas it has USAGE on, reaches partitions through their parent, leaves out extension objects, and never reads rows or comments.
- `UserDatabaseProbe.introspect` opens the connection the same way as `test` (pinned IP, SSL, timeouts), runs the read-only check again, then reads the schema inside `BEGIN READ ONLY` with a 15-second statement timeout. Above 2,000 tables or 50,000 columns it returns `SCHEMA_TOO_LARGE`.
- `test` and `introspect` share one private `withClient` method for connecting, error mapping, and closing.
- New error code `SCHEMA_TOO_LARGE` in `@ayd/shared`. SQLSTATE `57014` (statement timeout) gets its own message.

## AI usage

An AI assistant (Claude Code) designed and wrote the catalog queries, the probe method, and the tests. The developer approved the Phase 3 design and its three product choices beforehand.

## Suggestions accepted

- Query `pg_catalog`, not `information_schema`. It is faster on large catalogs and exposes partitions and extension membership.
- Re-run the read-only check on every introspection. Grants can change after the connection was saved.
- Read inside a READ ONLY transaction, as the executor phase will do for every query.
- Drop a primary or foreign key that names a column the login cannot read, so a hidden column name never reaches the snapshot.
- Prove each rule against PostgreSQL in a multi-schema scratch database, which is the Phase 3 acceptance test.

## Suggestions rejected

- A separate introspector class in the executor module. It would duplicate the connection setup that `UserDatabaseProbe` already owns.
- Truncating a schema above the limits instead of refusing it. A silently partial schema would make answers wrong in ways nobody could see.
- Reading PostgreSQL comments. The developer chose to keep only descriptions they write. The integration test plants a comment with a prompt-injection sentence and checks it never appears.

## Decisions

- Limits are a parameter with defaults, so tests can trigger `SCHEMA_TOO_LARGE` without creating 2,000 tables.
- Introspection runs in the API for now, like the probe (ADR 0008).

## What was checked

- Unit tests: 123 in the API. New: the statement-timeout message, introspection stopping before `BEGIN` when the login can write, the `BEGIN READ ONLY` / `SET LOCAL` / `COMMIT` order, and the table limit.
- Integration test `schema-introspection.int-spec.ts`, 7 cases on a scratch database with `public`, `sales`, and `hidden` schemas: sorted relations across schemas; kinds, types, nullability, composite primary key, and a foreign key; a table without a grant, a schema without USAGE, a partition, and an extension member left out; a column-level grant showing only its columns; no comment text; both limits; and a login that gained INSERT later being refused.

## Still open

- Nothing stores the result yet. The refresh endpoint comes next.
