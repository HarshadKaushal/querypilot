# AI review: file comments and named constants

Date: 2026-10-18
Base commit: `cfe5b9d` (refactor: move the application database from Prisma to Sequelize)

## What changed

Only comments changed, plus some numbers and strings moved into named constants. No behaviour changed.
This is the first of four commits in a readability cleanup. The goal is that a new developer can tell what each file is for without reading all of it.

- **What each file is for:** a short comment on the main class, or a `//` block after the imports. This matches the existing style.
  - API:
    - `AuthService`, `AuthController`, `TokenService`, `GoogleOAuthClient`, `SequelizeAuthRepository`, and `AuthGuard`.
    - `AllExceptionsFilter`, `HealthService`, and `AppLoggerModule`.
    - The connections, schema, SQL guard, jobs, health, and users controllers.
    - Both `main.ts` files.
  - Packages:
    - `@ayd/crypto` (envelope encryption, and why), `@ayd/ssrf-guard`, and every `@ayd/shared` file.
    - `ConnectionService`, `SchemaService`, `query-history.ts`, and `RedisModule`.
    - All nine database models.
- **`TokenService` now says why the JWT is written by hand:** it has one algorithm and three claims, so a library would add options that could be misconfigured.
- **Wrong or stale comments fixed:**
  - `cancelledOutcome()` said "Never retried" next to `retryable: true`. The comment now explains that `retryable` means the owner may submit the job again.
  - `query-job.runner.ts` still said "Phase 7 puts the model in front of the guard".
  - Two comments explained Sequelize code by comparing it with Prisma, which is gone. They are reworded to stand on their own.
  - The Swagger description said access tokens "last 15 minutes". That is only the default of `AUTH_ACCESS_TTL_SECONDS`.
- **Named constants:**
  - Auth:
    - `TokenService`: the AES-GCM layout (`IV_BYTES`, `TAG_BYTES`, `MIN_SEALED_BYTES`) and the refresh token size.
    - `AuthService`: the OAuth state size, the PKCE verifier size, and the dev-login defaults and length caps.
    - `GoogleOAuthClient`: the issuer list.
    - The sign-in rate limit's `ONE_MINUTE_MS`.
  - `@ayd/crypto`: the algorithm, key size, and IV size.
  - Customer databases:
    - `ConnectionService`: the field length limits are now one `MAX_LENGTH` table. A comment points to the web form that repeats them.
    - New `user-database/sqlstate.ts`: the PostgreSQL error codes the executor decides on. `query-error.ts` and `query-executor.ts` use it instead of bare strings like `'57014'`.
    - `query-executor.ts`: the slot lease margin and retry backoff.
    - `user-database.probe.ts`: `PROBE_TIMEOUT_MS`.
  - Answers:
    - `chart.ts`: the pie and bar row limits.
    - `prompt.ts`: the table-relevance weights and the description length.

## AI usage

An AI assistant (Claude Code) did the following:

- ran three read-only audits (API and worker, packages, web and docs);
- wrote the comments;
- made the edits by hand, apart from a small script that put a one-line comment above each model's `@Table`;
- checked every comment against the code it describes. For example, the usage-counter comment was corrected once it turned out the quota is counted in Redis, not in that table.

## Suggestions accepted

- The scope: docs plus targeted refactors, in four commits. This commit is comments and constants only.
- Following each file's existing comment style instead of adding a new header format.

## Suggestions rejected

- **Renames the audits suggested**, kept for later because they touch many call sites:
  - `upsertGoogleUser` (also used by dev login)
  - `ProbeRequest` (it is really a resolved connection target)
  - the SQL guard helpers `fields`, `str`, and `show`
  - `reuse()`

  They will be listed in `docs/conventions.md` under known inconsistencies.

- **Sharing `MINUTE` with `submission-limits.ts`:** the guard got its own `ONE_MINUTE_MS`. Importing a constant from an unrelated service file would tie the two together for no gain.

## Decisions

- **`retryable` keeps its meaning,** "the user may try again". Only the comment that contradicted it was fixed.

## Problems found

- **The intermittent API unit test is `src/health/health.controller.spec.ts`.**
  - It failed once in the full `npm test` run, right after every package was rebuilt, and that suite took 54 s.
  - It passed alone (4 of 4, 9 s) and in a full rerun (112 of 112).
  - The failing run's full output was not saved, so the cause is a hypothesis: Jest's 5 s per-test limit under cold-cache load. The spec itself uses only a fake `HealthService`.
- **`openapi.ts` had a closing brace out of indentation** in the working tree before this session's edits. Prettier put it back. It was a whitespace change only.

## What was checked

- **Build:** `npm run build` passes. It type-checks every package and the web app.
- **Unit tests (`npm test`):**
  - First run: API 111 of 112 (the health spec, see above), web 68, worker 6, core 293, sql-guard 310, ssrf 25, crypto 4, and shared 4.
  - API rerun: 112 of 112.
  - `npm test` still exits 1 on sql-guard's coverage threshold. That predates this commit.
- **Lint:** passes, with only the known TanStack Virtual warning.
- **Formatting:** Prettier, on every changed file.
- **Not run:** `test:int`, `test:e2e`, and the browser tests. Comments and same-value constants cannot change what those cover, and they run after the refactor commits.

## Still open

- If `health.controller.spec.ts` fails again, save the whole Jest output and check whether it is a timeout.
