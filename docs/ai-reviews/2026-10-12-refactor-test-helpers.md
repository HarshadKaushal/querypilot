# AI review: share test setup helpers

Date: 2026-10-12
Base commit: `193eb8e` (refactor: remove duplicated audit, error, and mapping code in the API)

## What changed

Second commit of the repository-wide cleanup. Test code only, plus the build configuration and docs.

- `apps/api/src/testing/test-env.ts`: `testEnv(overrides)` builds a valid `AppEnv` from one base. It replaced a 6-to-10 line settings block in five unit tests. It never reads `process.env`, as before.
- `apps/api/src/testing/http-app.ts`: `createHttpApp({ controllers, providers, env, google, requestId })` builds the Nest test app with the real auth stack, an in-memory user store, the real error filter, and a fixed request id. It replaced about 25 lines of setup in each of the four HTTP test files (auth, connections, schema, SQL check).
- `test/helpers/scratch-database.ts`: `plainClients` and `plainPools`, the SSL-off factories for the application Postgres, replace five copies in the integration tests.
- `apps/api/tsconfig.build.json` excludes `src/testing/**` and the `memory-*.repository.ts` fakes, so test code no longer ships in the API build. Production code imports neither; both were checked.
- `docs/testing.md` and `docs/implementation.md` describe the helpers, the contract-test pattern, and where errors, audit rows, and error logging go.

## AI usage

An AI assistant (Claude Code) wrote the helpers, converted the tests (mostly with scripts that stop on any unexpected file shape), and ran the checks.

## Suggestions accepted

- One environment helper with per-test overrides, so a test shows only what is special about it.
- An HTTP app helper that keeps each test's own controllers, providers, and request id visible at the call site.
- Excluding test-only code from the production build.

## Suggestions rejected

- Converting `config/env.spec.ts`. It tests the settings parser itself, so its inputs are written out on purpose.
- Moving the helpers into `packages/test-utils`. testing.md says to do that when a second app needs them; only the API does.

## Decisions

- `createHttpApp` defaults to dev login on and Google not configured. The auth test that needs Google passes its own settings and fake client, and the "Google not configured" test uses the default.
- The default fake Google client throws if called, so a test that reaches Google sign-in by mistake fails loudly.

## What was checked

- Unit tests in every workspace (API 208, guard 309), integration 59, end-to-end 3, ESLint, Prettier, and the full build all pass.
- A clean API build contains no `testing/` folder and no `memory-*` files (57 compiled files).
- Together with the previous commit, `apps/api/src` and `apps/api/test` changed by 627 insertions and 609 deletions. That includes the new contract tests (about 160 lines) and new comments.

## Still open

None from this commit. Bugs found during the review are listed in [2026-10-12-refactor-api-duplication.md](2026-10-12-refactor-api-duplication.md).
