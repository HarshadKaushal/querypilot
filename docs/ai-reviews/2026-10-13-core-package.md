# AI review: packages/core for the API and the worker

Date: 2026-10-13
Base commit: `11ca903` (fix: make token rotation and account deletion atomic, exact truncation)

## What changed

Phase 6 step 2, as ADR 0006 planned. Code moved; behavior did not change, except that the worker now uses the shared modules and every log line carries `service`.

**Moved from `apps/api/src` to `packages/core/src`** (with `git mv`, so history follows):

- `user-database/`: probe, introspection, pools, coordination, executor, error mapping, and their unit tests.
- `prisma/`, `redis/`, `logging/safe-error.ts`, `errors/error-code.ts`, and `schema/schema-document.ts`.
- `testing/memory-coordination.ts`.

**New in core:**

- `config/env.ts`:
  - `coreEnvFields`: the database, Redis, row cap, executor limits, log level, and environment settings.
  - `parseEnv`, which names bad fields and never their values.
  - `loadRootEnvFile`, `ROOT_ENV_FILE`, and the `APP_ENV` token.
- `logging/logger.module.ts`: `createLoggerModule({ service, genReqId? })`, with the one redaction list both processes use.
- `testing/test-env.ts`: `coreTestEnv()`.

**API:**

- The settings schema spreads `coreEnvFields` and adds its own fields.
- `AppConfigModule` re-exports core's `APP_ENV`, so the API's own imports did not change.
- The logger uses the factory plus the request-id hook.
- 23 files import from `@ayd/core` instead of relative paths.
- `ioredis`, `dotenv`, and `pino` are no longer direct dependencies of the API.

**Worker:**

- Its settings are `coreEnvFields`, so it now requires `DATABASE_URL`, which jobs will need.
- It provides `APP_ENV` from its own global module, logs through `createLoggerModule({ service: 'worker' })`, and pings Redis through core's `RedisService`.
- Its hand-written `WorkerRedis` class is gone.

**Build and run:**

- `@ayd/core` builds after `@ayd/database`, in the root scripts, the API's `test:unit`, and both Dockerfiles.
- Compose gives the worker `DATABASE_URL` and makes it wait for the app database.
- Docs: ADR 0006 records what moved and what waits. ADR 0008, ADR 0010, the blueprint, features, implementation, testing, and the README layout use the new paths.

## AI usage

An AI assistant (Claude Code) mapped every import in the API to find what the executor depends on, moved the files, rewrote imports with a script that merges them into one `@ayd/core` import per file, and ran the checks.

## Suggestions accepted

- Move only infrastructure now. The user chose this, with connection test, schema refresh, and query execution all becoming worker jobs in step 3.
- Switch the worker to core in the same change, so the package has two callers from the start, as ADR 0006 asks.
- Keep `APP_ENV` as one token in core, with each app providing it. Core modules read only the core fields.

## Suggestions rejected

- **Moving connection target resolution, crypto key handling, and schema allowlist reads now.** The worker does not call them until step 3. Moving them now would create code with one caller, which ADR 0006 warns against.
- **Moving the HTTP exception class (`app.exception.ts`) and the exception filter.** Both are HTTP concerns and stay in the API.
- **Moving the API's executor integration tests into core.** They need the API's scratch-database helper and test command; they now import from `@ayd/core`.

## Decisions

- **The worker's log lines lost `service` at first.** The shared factory put it in pino-http's `customProps`, which applies only to request logs. It is now in pino's `base`, so every line has it. API startup lines have it too, which `implementation.md` already claimed and was not true before.
- `pino-http` is a declared dependency of core. `nestjs-pino` needs it as a peer.

## What was checked

- Prettier, ESLint, and the full build pass.
- Unit tests: API 142 plus core 68, which is the API's previous 210. Worker 4 (one new: `DATABASE_URL` is required). Guard 310 and the other packages pass.
- Integration 59 and end-to-end 3 pass. No `testing/` or `memory-*` files are in the API or core builds.
- `npm run try-query` ran a live query through core's executor.
- `docker compose up --build`:
  - API healthy; worker logs `{"service":"worker","message":"worker ready"}`.
  - API request logs carry `service: "api"` and the request id, and an `Authorization` header shows as `[redacted]`.

## Still open

- Step 3 moves connection target resolution, crypto key handling, and the allowlist reads into core when the worker jobs need them.
