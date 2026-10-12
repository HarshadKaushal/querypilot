# AI review: rename unclear API folders and move test fakes into src/testing

Date: 2026-10-12
Base commit: `e7d8f10` (chore: upgrade every dependency to its latest stable release)

## What changed

Moves and renames only. No behavior, route, or SQL changed.

- `apps/api/src/executor/` → `apps/api/src/user-database/`, and `ExecutorModule` → `UserDatabaseModule`.
  - The folder held more than query execution: the read-only probe, schema introspection, connection pools, Redis coordination, and connection error mapping. Its one job is connecting to customer databases.
  - `QueryExecutor` keeps its name.
  - A comment on the module says it is the blueprint's Executor module.
- `apps/api/src/meta/` → `apps/api/src/egress/`, with `MetaController` → `EgressController` and `MetaModule` → `EgressModule`.
  - The URL stays `GET /v1/meta/egress`, so clients and docs that call it are unaffected.
- The in-memory fakes moved into `apps/api/src/testing/`:
  - `memory-auth.repository.ts`, `memory-connection.repository.ts`, and `memory-schema.repository.ts`.
  - `MemoryCoordination`, which had lived inside the production `coordination.ts`.
  - `tsconfig.build.json` now excludes only `src/**/*.spec.ts` and `src/testing/**`. The filename rule for the fakes is gone.
- Docs: blueprint rule 7, ADR 0008, ADR 0010, and features.md name `src/user-database/` as the Executor module's home. testing.md says where the fakes live.

## AI usage

An AI assistant (Claude Code) proposed the changes in a directory-structure review, moved the files with `git mv`, rewrote imports with a script driven by `git ls-files`, and ran the checks.

## Suggestions accepted

- Rename `executor/` to say what it is. The user chose this over keeping the blueprint's word, after being told the two would differ. The blueprint now gives the code location next to the term.
- Give `meta/` a specific name.
- One excluded folder for every test fake, instead of a filename pattern.

## Suggestions rejected

- `setup/` as the new name for `meta/`. `egress/` matches the URL (`/v1/meta/egress`) and the docs' "egress helper".
- Changing the URL to match the folder. That would change public behavior for a rename.
- Grouping `prisma/`, `redis/`, `logger/`, and `config/` under `src/infrastructure/`, or merging `src/testing/` with `test/helpers/`. Judged not worth the churn at this size.

## Decisions

- `MemoryCoordination` moved even though only the repository fakes were named in the review, so no test fake ships in the production build.
- Running Prettier over `apps/` removed trailing spaces an editor had added to `query-executor.ts`. The file is now an exact rename of the committed version.

## What was checked

- Prettier, ESLint, and the build pass.
- A clean API build (`dist` deleted first) has `user-database/` and `egress/`, no `executor/` or `meta/`, and no `testing/` or `memory-*` files.
- Unit tests in every workspace (API 208, guard 309), integration 59, and end-to-end 3 pass.
- `npm run try-query` ran a live query through the renamed module.
- `git diff -M` shows every move as a rename, so `git log --follow` keeps each file's history.

## Still open

Nothing from this change.
