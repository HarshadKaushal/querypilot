# AI review: Prisma to Sequelize

## What changed

The application database moved from Prisma 7 to Sequelize 6 (ADR 0015).

- `packages/database`: Prisma's schema, SQL migrations, config, and scripts were removed. In their place:
  - `src/enums/`: `PlanTier`, `ConnectionStatus`, `SslMode`, `QueryKind`, `QueryStatus`.
  - `src/types/`: one `<Table>Attributes` and `<Table>CreationAttributes` pair per table.
  - `src/models/`: nine `sequelize-typescript` models.
  - `src/create-sequelize.ts`: the shared connection settings.
  - `migrations/`: seven sequelize-cli migrations, six that rebuild Prisma's tables and one that makes the time columns `TIMESTAMPTZ(3)`.
  - `config/database.cjs`, `.sequelizerc`, and `scripts/migrate.cjs`, which adopts a Prisma-built database before migrating.
- `packages/core`: `src/database/database.module.ts` and `database.service.ts` replace `src/prisma/`. The connection, schema, history, proposal cache, usage counter, and audit writer implementations are now `Sequelize…` classes behind the same interfaces. `writeAuditLog(entry, transaction?)` takes an optional transaction instead of a Prisma client. `connection.service.ts` uses `ConnectionStatus`; `SslMode` now comes from `@ayd/database`.
- `apps/api`: `SequelizeAuthRepository`, `DatabaseModule` in `AppModule`, the health check on `DatabaseService`, `try-query.cjs` on the `User` model, and no Prisma generate step in the scripts. `sequelize` added as a dependency for `Op`.
- `apps/worker`: `DatabaseModule` in place of `PrismaModule`.
- Tests: all 11 integration files that used Prisma now use the models and `openAppDatabase()` (`apps/api/test/helpers/app-database.ts`). New tests: a time round-trip in `database.int-spec.ts` and 20 concurrent usage additions in `limits.int-spec.ts`.
- Config: Prisma entries removed from `.gitignore`, `.prettierignore`, and `eslint.config.mjs`; the build-stage `DATABASE_URL` removed from both Dockerfiles.
- Docs: ADR 0015 (new), ADR 0004 and 0006, README, `features.md`, `implementation.md`, `testing.md`, `dependency-advisories.md`, and `CONTEXT.md`.

## AI usage

Claude (Opus 5.5) wrote the code, migrations, tests, and docs in one session, after reading every file that used Prisma and checking library behaviour in the installed sources (`@nestjs/sequelize` only syncs with `autoLoadModels`; Sequelize parses only `timestamptz`; `bulkCreate` supports `conflictAttributes` with `updateOnDuplicate`; sequelize-cli accepts `.cjs`; Sequelize calls `uuid` v1 and v4 only).

## Suggestions accepted

- Sequelize, because the brief requires it (user).
- Rewrite the migrations as sequelize-cli JavaScript rather than run Prisma's SQL files through Umzug (user; Claude had recommended keeping the SQL). The risk was a slightly different schema, so the result was compared with `pg_dump`.
- `sequelize-typescript` with `@nestjs/sequelize` rather than plain `Model.init` (user; Claude had recommended plain Sequelize for fewer dependencies).
- Models, services, modules, and types or enums each in their own files (user).
- Work in the main folder rather than a git worktree, accepting that the other session's dev API would break meanwhile (user).
- Migrate the real development database once the copy had passed (user).
- A migration to `TIMESTAMPTZ(3)` instead of a global `pg` type parser (Claude), so customer query results are read as before.

## Suggestions rejected

- `@InjectModel` and `SequelizeModule.forFeature` in every module: more wiring for the same queries. The repositories use the static models and take `DatabaseService` for transactions.
- Sequelize's `upsert` for usage counters (it overwrites rather than adds) and for the proposal cache (it would reset `hits` and change the id).
- `npm audit fix --force` (it would downgrade Jest, ts-jest, and `sequelize-typescript`).

## Decisions

- Enums are `as const` objects with a type of the same name, so existing string literals still type-check.
- Creation types make every nullable or defaulted column optional, as Prisma did.
- `_prisma_migrations` stays in adopted databases; nothing reads it after adoption.
- The `uuid` advisory under Sequelize is accepted (`docs/dependency-advisories.md`).

## Problems found

- **Time zones:** Sequelize would have read the `TIMESTAMP` columns as local time, which is 5 h 30 min wrong in India and would affect refresh-token expiry. Fixed with the `TIMESTAMPTZ(3)` migration and covered by a round-trip test.
- **A missed enum value:** typing `connections.status` found `'failing'` (`ConnectionService.recordTest`), which a text search had missed.
- **Class fields:** with ES2022 class fields, model properties would hide Sequelize's getters; `packages/database` compiles with `useDefineForClassFields: false`.
- **Partial updates:** Sequelize writes `NULL` for an `undefined` value where Prisma skipped it; the connection repository drops `undefined` keys first.
- **sql-guard coverage threshold:** `npm test` exits non-zero because `@ayd/sql-guard` reports 98.83% function coverage against its 100% threshold (`index.ts`). All 310 tests pass. sql-guard and every existing package version are unchanged by this work (lockfile compared), so this predates it; not fixed here.

## What was checked

- Schema: a fresh database migrated to `20261014170000` and the Prisma-built `ayd` gave identical `pg_dump --schema-only` output (160 lines each).
- Adoption and the time zone migration on a copy of `ayd`: same row counts and same sum of instants before and after; a second run did nothing. Then the same on `ayd` itself: 6 users, 5 connections, 11 queries, same sums; all seven migrations `up`.
- `tsc` for `@ayd/database`, `@ayd/core`, the API build config, and the worker.
- Unit tests: API 112, web 68, worker 6, core 293, sql-guard 310, ssrf 25, crypto 4, shared 4, all passing (sql-guard's coverage threshold as above).
- `npm run test:int`: 97 passed (95 before, plus the two new tests).
- `npm run test:e2e`: 3 passed.
- `npm run lint`: the one known warning. `prettier --check` on every changed file.
- The other session's running dev API answered `/health/ready` with the database up, on the new code.
- The two scratch databases (`ayd_seq_fresh`, `ayd_seq_copy`) were dropped.

## Still open

- Browser tests (`npm run test:browser`) were not run, because another session's dev servers were in use.
- The sql-guard function coverage threshold (above).
- `sequelize-typescript` has had no release since 2023; watch it when upgrading Sequelize.
- `CLAUDE.md` and `docs/blueprint.md` still name Prisma; they are the user's instructions and the original plan, so they were left as they are. The choice is recorded in `CONTEXT.md`.
