# Testing

Unit tests sit next to the code. Everything that needs infrastructure lives in its own folder, config, and command.

| Type               | Needs                                     | Location                                          | Naming                       |
| ------------------ | ----------------------------------------- | ------------------------------------------------- | ---------------------------- |
| Unit               | No database, Redis, or network            | Next to the source file                           | `*.spec.ts`                  |
| Integration        | Real Postgres and Redis                   | `apps/<app>/test/integration/`                    | `*.int-spec.ts`              |
| API end-to-end     | The Nest app plus real Postgres and Redis | `apps/api/test/e2e/`                              | `*.e2e-spec.ts`              |
| Browser end-to-end | Web, API, worker, and databases           | `e2e/` at the repo root, when the web app exists  | `*.spec.ts`                  |
| Evaluation         | A model and the sample database           | `eval/` at the repo root, in the evaluation phase | dataset, runner, and results |

## Commands

```powershell
npm test
npm run test:int
npm run test:e2e
npm run test:all
```

`npm test` is `test:unit`. It has to finish without Docker. The API, the worker, and `@ayd/core` run Jest through `scripts/jest.cjs`, which turns on Node's VM modules so Jest can load NestJS 12, an ES-module-only package. Integration and API end-to-end tests expect `npm run up:deps` and `npm run migrate --workspace=@ayd/database` first. They use port 5434 and Redis on 6379 on a laptop. CI points them at its own Postgres and Redis.

Playwright and the evaluation runner are not created yet. They get their own commands when those folders exist. Evaluation reports accuracy. It is not a pass/fail suite, and it is the only place a real model is called.

## Rules

- Never call Gemini, or any other live model, from a test. Use a fake provider. Real model calls belong in `eval/`.
- Each integration test starts from a clean database state. Tests must not depend on rows left by another test.
- Prefer many unit tests, fewer integration tests, and a short browser suite that covers the demo flow only.
- Safety code gets the heavy coverage: the SQL guard, the SSRF guard, authorization, encryption, and read-only execution. There is no global coverage percentage. `@ayd/ssrf-guard` and `@ayd/crypto` are unit-tested with no network.
- Security cases are data-driven. One attack string is one line in a file under the package that owns the check, so a new case does not need a new test function.
- Shared fakes and factories go in `packages/test-utils` when a second app needs them. Until then, a fake can live next to the test that uses it.
- API unit tests build their environment with `testEnv()` and HTTP tests their app with `createHttpApp()`, both in `apps/api/src/testing/`. `@ayd/core` has its own `coreTestEnv()` and `MemoryCoordination` in `packages/core/src/testing/`, also excluded from its build. The in-memory fakes of the repositories and of Redis coordination live there too, and the whole folder is excluded from the production build.
- Every in-memory fake of a repository must behave like the real one. `test/integration/auth-repository.int-spec.ts` runs one contract against both auth repositories. Follow that pattern when a fake carries security rules.
- A fake `pg` client cannot prove a privilege rule. Tests that depend on how PostgreSQL resolves grants use `apps/api/test/helpers/scratch-database.ts`, which creates a throwaway database and suffixed roles on the `DATABASE_URL` server and drops them afterward. Its `plainClients` and `plainPools` factories turn SSL off for that server, which has no TLS.

## CI

On every push: lint, format check, unit tests, and build.

On every push, in a second job: migrate a Postgres service, then integration and API end-to-end tests.

Browser tests run when `e2e/` exists, on pull requests. Evaluation runs when `eval/` exists, on a schedule and when prompts or models change.
