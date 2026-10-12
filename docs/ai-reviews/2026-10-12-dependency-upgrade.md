# AI review: upgrade every dependency to its latest stable release

Date: 2026-10-12
Base commit: `dc30d53` (test: share test setup helpers and keep test code out of the build)

## What changed

Every npm package, Docker image, and CI action moved to its newest stable release, with two exceptions listed under Decisions.

| Area           | Before                             | After                                             |
| -------------- | ---------------------------------- | ------------------------------------------------- |
| Node           | 22                                 | 24 LTS (`engines` `>=24.9`, `.nvmrc`, images, CI) |
| TypeScript     | 5.9                                | 6.0.3                                             |
| ESLint         | 9                                  | 10 (`@eslint/js` 10, `typescript-eslint` 8.71)    |
| NestJS         | 11                                 | 12.1                                              |
| nestjs-pino    | 4 (pino 9)                         | 5.3 (pino 10)                                     |
| Prisma         | 6.19 (`prisma-client-js`)          | 7.10 (`prisma-client`, `@prisma/adapter-pg`)      |
| Zod            | 3.25                               | 4.6                                               |
| ioredis        | 5                                  | 6                                                 |
| dotenv         | 17                                 | 18                                                |
| SQL parser     | libpg-query 17.7.4, deparser 17.18 | libpg-query 18.1.5, deparser 18.3.10              |
| Postgres image | 16                                 | 18 (app database, sample database, CI)            |
| Redis image    | 7                                  | 8                                                 |
| CI actions     | checkout v4, setup-node v4         | checkout v7, setup-node v7                        |

Jest, ts-jest, Prettier, supertest, pg, tsx, and the `@types` packages took their latest minor releases. `@types/node` is now a declared root dependency.

Code changes the upgrades required:

- **TypeScript 6:** `moduleResolution: node` (node10) is deprecated, and `types` no longer defaults to every installed `@types` package. `tsconfig.base.json` now uses `module: node20`, `moduleResolution: node16`, and `types: ["node", "jest"]`.
- **NestJS 12 ships only as ES modules.** The code stays CommonJS. Node 24 can `require()` an ES module, and TypeScript's `node20` mode allows that.
  - Jest needs `--experimental-vm-modules` to do the same. `scripts/jest.cjs` starts Jest with it, and the API and worker test scripts use that launcher.
  - `main.ts` passes `new ExpressAdapter()` to `NestFactory.create`. Without it, Nest looked up `@nestjs/platform-express` from its own install folder, could not see the API's copy, and the built API did not start. No test caught this; starting the built API did.
- **Prisma 7:**
  - New `prisma-client` generator, writing CommonJS into `packages/database/src/generated`. That folder is gitignored and skipped by lint and Prettier.
  - The database URL moved from `schema.prisma` to `prisma.config.ts`, which loads the root `.env`.
  - `@ayd/database` exports `postgresAdapter(url)` with the 5-second connect timeout Prisma 6 had (pg alone waits forever), and `createPrismaClient()` for tests and scripts.
  - `PrismaService` passes the adapter.
- **Zod 4:** replaced the deprecated `z.string().url()`, `z.ZodIssueCode.custom`, and `message:` with `z.url()`, `'custom'`, and `error:`.
- **PostgreSQL 18 grammar:** `A_Expr` (operators, including `IN`) gained `rexpr_list_start` and `rexpr_list_end`, the text positions of an `IN` list's parentheses. The default-deny walk rejected them, as designed, and two corpus queries failed. They are now allowed next to `location`.
- **Postgres 18 image:** it keeps data under `/var/lib/postgresql/18` and cannot open a 16 data directory. The volumes are now `app_db_data_18` and `sample_db_data_18`, mounted at `/var/lib/postgresql`. The old volumes were not deleted.

## AI usage

An AI assistant (Claude Code) checked the newest versions and their requirements on npm, read the Prisma 7 upgrade guide, upgraded in stages (tooling, runtime libraries, Prisma, parser, images), fixed what broke, and ran every check after each stage.

## Suggestions accepted

- Upgrade in stages and run the tests after each one, so each break has one cause.
- Keep CommonJS and rely on Node's `require()` of ES modules, instead of converting the whole repository to ES modules.
- Name the Postgres volumes per major version instead of wiping the old ones.
- Diff the PostgreSQL 17 and 18 parse-tree types instead of trusting the corpus alone.

## Suggestions rejected

- **TypeScript 7.0.2.** `typescript-eslint` supports TypeScript below 6.1 and ts-jest below 7, so lint and tests would stop working. 6.0.3 is the newest version both support.
- **Prisma 8.** npm's `latest` tag for the `prisma` CLI points at `8.0.0-rc.22`, a release candidate. `@prisma/client`'s `latest` is 7.10.0, the newest stable.
- **Converting the repository to ES modules.** It would touch every relative import (they need `.js` extensions) and every Jest config, for no gain now that Node 24 can load ES modules from CommonJS.
- **An npm override to force a patched `mysql2` under the Prisma CLI.** Prisma pins an exact version, and the last override attempt broke the install (see the advisories doc).

## Decisions

- The SQL parser moved to the PostgreSQL 18 grammar. The diff of parse-tree types shows the other new fields are in nodes the guard already rejects (`ARRAY[...]`, `RETURNING`, analyzed-tree nodes). SQL that only a newer server accepts fails on an older one with an error, not a different meaning. ADR 0009 records the move.
- The `--experimental-vm-modules` flag only applies to tests. The API and worker run on plain Node.
- Accepted a new advisory: `mysql2` (high), pulled in by the Prisma 7 CLI. This project never connects to MySQL. Recorded in `docs/dependency-advisories.md`. `deepmerge-ts` is still present, because Prisma 7.10 still pins 7.1.5.

## What was checked

- After every stage: build, ESLint, Prettier, and unit tests (API 208, guard 309, others pass).
- On Postgres 18 and Redis 8 with fresh volumes: migrations apply, integration 59 and end-to-end 3 pass.
- The built API started with `node dist/main.js`: readiness green, dev login 200, and an unauthenticated request got 401.
- `docker compose up --build`: the API and worker images build and start on Node 24.21. The API reports healthy and the worker logs "worker ready".
- `npm run try-query` against the Postgres 18 sample database ran an `IN (...)` query end to end: guard, executor, Redis slots.
- `npm outdated` lists only TypeScript 7 and the Prisma 8 release candidate.
- Not checked: CI itself, since the repository has no remote. The workflow changes are version numbers only.

## Still open

- Old Docker volumes `database_assist_app_db_data` and `database_assist_sample_db_data` (Postgres 16 data) can be removed with `docker volume rm` once nothing in them is needed.
- Move to TypeScript 7 when `typescript-eslint` and ts-jest support it.
- Move to Prisma 8 when it leaves release candidate.
