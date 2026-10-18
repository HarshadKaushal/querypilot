# AI review: one folder per table in packages/database

Date: 2026-10-18
Base commit: `e474b61` (docs: add a request-flow guide, conventions, and a README per app and package)

## What changed

`packages/database/src` is now organised by table instead of by kind of file. No behaviour changed, and no file outside the package changed its imports.

- **Before:** `src/models/`, `src/types/`, and `src/enums/`. To read the `connections` table you opened `models/connection.model.ts`, `types/connection.types.ts`, `enums/connection-status.enum.ts`, and `enums/ssl-mode.enum.ts`, in three folders.
- **After:** `src/tables/<table>/`, one folder per table, each with `<table>.model.ts`, `<table>.types.ts`, its enums, and an `index.ts`. The nine folders are `user`, `refresh-token`, `audit-log`, `connection`, `schema-snapshot`, `allowed-object`, `query-cache-entry`, `query-record`, and `usage-counter`.
- Every enum belongs to exactly one table, so each one moved next to its table:
  - `PlanTier` is in `user/`.
  - `ConnectionStatus` and `SslMode` are in `connection/`.
  - `QueryKind` and `QueryStatus` are in `query-record/`.
- **The `models` list** that Sequelize registers moved from `models/index.ts` to `tables/index.ts`, which also re-exports every table folder. `create-sequelize.ts` imports it from `./tables`.
- Every file was moved with `git mv`, and each file's contents changed only in its relative imports. For example, `'../enums/ssl-mode.enum'` became `'./ssl-mode.enum'`, and `'./user.model'` became `'../user/user.model'`. Prettier joined one import onto one line in `audit-log.model.ts`.
- **Docs:** the package README, ADR 0004, ADR 0015 (a dated "Layout changed" paragraph, with the old text kept), the root README, `conventions.md`, `implementation.md` (the "new table" checklist), and `CONTEXT.md`.

## AI usage

An AI assistant (Claude Code) did the following:

- explained the existing layout to the user, which showed that services already exist in `packages/core`;
- offered three layouts, and the user chose one folder per table;
- moved the files with a shell loop of `git mv`, rewrote the relative imports with `sed`, and generated each folder's `index.ts`;
- wrote `tables/index.ts` and the doc changes by hand.

## Suggestions accepted

- **One folder per table,** chosen by the user over two alternatives: merging the enums into the types files, or leaving the layout as it was.
- **A `tables/` parent folder,** so the nine table folders do not sit next to `create-sequelize.ts`.
- **Keeping every exported name,** so the 22 files that import `@ayd/database` did not change.

## Suggestions rejected

- **A `services/` folder in `packages/database`,** next to the models. The core repositories already hold the queries, and the core services hold the rules. Services here would duplicate them and bring Nest into a package that has none.

## Decisions

- **The user chose** one folder per table (2026-10-18).
- **Folders are named after the model in kebab case** (`query-record`), not after the SQL table (`queries`), to match the file names inside.

## Problems found

- None in the code. The untracked `docs/sequelize.md`, which another session owns, still describes `src/models/`, `src/types/`, and `src/enums/`. It was not edited.

## What was checked

- `npm run build`, after deleting `packages/database/dist`: passed for every workspace, including the API and worker that import the models.
- **A runtime check:** loading the built package, `createSequelize()` registered all nine models. `Connection.build({...})` read back `id`, `status`, and `port`, the enums were exported, and the `Connection.user` association was present.
- `npm run lint`: passed, with the one known TanStack Virtual warning.
- `npm run format:check`: clean for this commit's files. The only flag is the other session's `docs/sequelize.md`.
- `npm test`: API 112, web 72, worker 6, core 293, sql-guard 310, ssrf 25, crypto 4, shared 4, all passed. It exits 1 on the known sql-guard function-coverage threshold (98.83%), which predates this change.

## Still open

- **`npm run test:int` was not run,** because Docker Desktop was stopped. It is the check that runs the models against real Postgres.
- **Commit 2** gives the core storage areas (history, proposal cache, usage counters, and audit) the same interface-plus-Sequelize file layout as `connections/`.
