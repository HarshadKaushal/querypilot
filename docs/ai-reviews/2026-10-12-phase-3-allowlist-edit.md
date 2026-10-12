# AI review: edit the allowlist and descriptions

Date: 2026-10-12
Base commit: `4832fda` (feat(schema): refresh snapshots and serve the allowlisted schema)

## What changed

Fifth slice of Phase 3. `PUT /v1/connections/:id/allowlist` replaces a connection's allowlist and returns the allowed schema with its new fingerprint.

- The body is `{ version, tables: [{ schema, name, description?, columns?: [{ name, description? }] }] }`. Columns sit under their table, so a column cannot be allowed without its table.
- `version` must be the latest snapshot. If a refresh happened after the editor loaded, the save fails with `SCHEMA_CHANGED` (409). The repository repeats that check under the same row lock a refresh takes, so the two cannot interleave.
- Every table and column must exist in that snapshot. Duplicates are rejected.
- Descriptions are trimmed, whitespace runs become one space, control characters are removed, and anything over 500 characters is rejected.
- Each save writes an `allowlist.updated` audit row with the version and how many tables and columns are allowed.

## AI usage

An AI assistant (Claude Code) designed and wrote the route, the input parser, the repository method, and the tests.

## Suggestions accepted

- Require the snapshot version in the body (optimistic concurrency). Without it, a save made against an old snapshot could silently re-allow choices the user never saw for the new one.
- Replace the whole allowlist per save. It keeps the logic small and matches what an editor sends.
- Clean descriptions before storing them, because they will be sent to the model in the LLM phase.

## Suggestions rejected

- PATCH-style partial edits (allow one column at a time). More states to validate, and the editor already holds the full list.
- Accepting a description with newlines as-is. Collapsing whitespace keeps one description from reshaping the prompt it is placed in. Safety still never depends on prompt wording.
- Ignoring unknown names silently. A typo would look saved while nothing changed.

## Decisions

- An unknown table or column is `VALIDATION_ERROR` with a message that says to reload, not a new error code.
- An empty `tables` list is allowed. It hides everything, which is a valid choice.

## What was checked

- Unit tests: 157 in the API. `allowlist-input.spec.ts` (14): nested rows, empty list, table without columns, eleven rejected bodies, and description cleaning. `schema.http.spec.ts` gains 4: a save with descriptions that changes the fingerprint and writes the audit row, `SCHEMA_CHANGED` after a refresh, an unknown column, and another user's connection.
- Integration: 28 pass. The end-to-end refresh test now saves an allowlist with descriptions, refreshes, and checks the choices and descriptions survive.

## Still open

- The sample database is single-schema, and the docs do not describe Phase 3 yet. Both come in the last slice.
