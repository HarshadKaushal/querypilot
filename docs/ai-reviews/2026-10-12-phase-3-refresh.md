# AI review: refresh snapshots and serve the allowlisted schema

Date: 2026-10-12
Base commit: `e53e8e5` (feat(executor): introspect the schema a read-only login can see)

## What changed

Fourth slice of Phase 3: the schema module and its first three routes.

- `POST /v1/connections/:id/schema/refresh` introspects the database and stores the next snapshot version. The first snapshot gets the default allowlist. Later snapshots keep allowlist rows for objects that still exist, drop the rest, and leave new objects hidden. The response lists the new objects. A successful refresh marks the connection `active`. A failed one marks it `failing`, except `SCHEMA_TOO_LARGE`, which means the connection works. Each refresh writes a `schema.refreshed` audit row.
- `GET /v1/connections/:id/schema` returns only allowed tables and columns, with descriptions, keys whose columns are all visible, and a fingerprint.
- `GET /v1/connections/:id/allowlist` returns every object in the latest snapshot with `allowed`, `sensitive`, and `description`, for the allowlist editor.
- `schema/allowed-schema.ts` holds the pure logic: default allowlist, reconciliation, new objects, the allowed schema, the fingerprint, and the editor view.
- `PrismaSchemaRepository.commitSnapshot` locks the connection row, takes the next version, replaces the allowlist, and deletes all but the newest five snapshots, in one transaction.
- `ConnectionService` gains `resolveTarget` (ownership, decryption, SSRF pinning) and `recordTest`, and `test()` now uses them. `probeError` is exported. New error code `SCHEMA_NOT_READY` (409).

## AI usage

An AI assistant (Claude Code) designed and wrote the module, the repositories, and the tests, following ADR 0008 and the Phase 3 choices the developer approved.

## Suggestions accepted

- Build every model-facing schema through one function, `allowedSchema`, so the allowlist is enforced in one place.
- Drop a primary or foreign key unless every column it names is allowed, so hidden column names cannot leak through keys.
- Lock the connection row while committing, so concurrent refreshes get distinct versions.
- Pass the user id into every repository call and filter on it, as defense in depth behind the service's ownership check (blueprint rule 8).
- Extract `resolveTarget` from `test()` instead of copying the decrypt-and-pin steps into the schema module.

## Suggestions rejected

- Reading the schema automatically when a connection is created. It would make creation slower and mix two kinds of failure in one call. The wizard can call refresh right after.
- Skipping a new version when nothing changed. The blueprint says a refresh creates a new version. The fingerprint includes the version, so a refresh always invalidates cached SQL, as the blueprint asks.
- Keeping every snapshot. Repeated refreshes of a large schema would grow without bound, and nothing reads old versions yet.

## Decisions

- `SCHEMA_TOO_LARGE` is 422 and does not mark the connection failing.
- `SCHEMA_NOT_READY` is 409, because the request is valid but has to wait for a refresh.
- The snapshot stores `tableCount` and `columnCount` so a later list view does not need to parse the document.

## What was checked

- Unit tests: 139 in the API. `allowed-schema.spec.ts` (9) checks that nothing outside the allowlist appears, including through keys, plus reconciliation, new objects, fingerprint changes, and the editor view. `schema.http.spec.ts` (7) covers sign-in, `SCHEMA_NOT_READY`, defaults on the first refresh, hidden new objects on the second, another user's connection as 404 on all three routes, `NOT_READ_ONLY` marking the connection failing, and `SCHEMA_TOO_LARGE` leaving it active.
- Integration test `schema-refresh.int-spec.ts` (5), end to end through Prisma and a multi-schema scratch database: version 1 across two schemas with the email column hidden; version 2 after adding a column and a table and dropping one, with new objects hidden and the dropped table's rows gone; two concurrent refreshes getting versions 3 and 4, and only versions 3 to 7 kept after more refreshes; another user refused; audit rows written without the password.
- The end-to-end suite boots the full app module, which now includes `SchemaModule`.
- ESLint flagged a line that began with `[` after Prettier wrapped a dynamic method call in the HTTP test. The helper now calls `get` or `post` directly.

## Still open

- Editing the allowlist and descriptions (`PUT /v1/connections/:id/allowlist`) is the next slice.
