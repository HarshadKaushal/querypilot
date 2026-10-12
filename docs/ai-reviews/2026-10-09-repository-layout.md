# AI review: repository layout

Date: 2026-10-09
Scope: database package, docs index, ADRs, test commands, CI split
Related decisions: [ADR 0004](../adr/0004-database-package.md), [ADR 0005](../adr/0005-test-layout.md), [ADR 0006](../adr/0006-defer-core-package.md)

## What was reviewed

- The schema move does not change tables. Existing migrations were moved as files, so a database that already applied them does not re-run them.
- Unit tests still do not open Postgres or Redis. Integration and end-to-end tests are separate Jest configs and a separate CI job.
- `packages/core` was not created. The worker still has its own env parser. The ADR says to extract shared Nest modules before Phase 6, not before Phase 2.
- The blueprint file moved to `docs/blueprint.md` without an edit to its text.

## Decisions

- `@ayd/database` re-exports `PrismaClient` from the generated client. Apps do not import `@prisma/client` themselves.
- `npm test` stays the fast command. Integration is opt-in locally and required in CI.
- CODEOWNERS names `@harsh` as a placeholder until the GitHub review team is known.

## Follow-ups

- Rebuild the API image before the next `npm run up`, so the container runs migrations from `packages/database`.
- Add `packages/test-utils` when a second app needs the same fake.
- Add Playwright and `eval/` in the phases that introduce the web app and the model comparison.
