# Testing

Unit tests sit next to the code. Everything that needs infrastructure lives in its own folder, config, and command.

| Type               | Needs                                     | Location                                          | Naming                       |
| ------------------ | ----------------------------------------- | ------------------------------------------------- | ---------------------------- |
| Unit               | No database, Redis, or network            | Next to the source file                           | `*.spec.ts`, `*.spec.tsx`    |
| Integration        | Real Postgres and Redis                   | `apps/<app>/test/integration/`                    | `*.int-spec.ts`              |
| API end-to-end     | The Nest app plus real Postgres and Redis | `apps/api/test/e2e/`                              | `*.e2e-spec.ts`              |
| Browser end-to-end | Web, API, worker, and databases           | `e2e/` at the repo root                           | `*.spec.ts`                  |
| Evaluation         | A model and the sample database           | `eval/` at the repo root, in the evaluation phase | dataset, runner, and results |

## Commands

```powershell
npm test
npm run test:int
npm run test:e2e
npm run test:all
npm run test:browser
npm run test:browser:live
```

`npm test` is `test:unit`. It has to finish without Docker. The web app runs Vitest with Testing Library in jsdom (`vitest run`), on the same Vite config as the app; its page tests use `renderWithApp()` and `fakeApi()` from `apps/web/src/test/render.tsx`, which give a page the app's providers and a mocked API client instead of a server. `job()` and `eventStream()` in the same file build job views and a streamed response in the API's event format, for pages that follow jobs. The API, the worker, and `@ayd/core` run Jest through `scripts/jest.cjs`, which turns on Node's VM modules so Jest can load NestJS 12, an ES-module-only package. Integration and API end-to-end tests expect `npm run up:deps` and `npm run migrate --workspace=@ayd/database` first. They use port 5434 and Redis on 6379 on a laptop. CI points them at its own Postgres and Redis.

Browser tests use Playwright (`e2e/`). `npm run test:browser` builds everything, then starts its own API (port 3100), worker, and web dev server (port 5174) on their own job queue (`ayd-e2e`), so they never meet the servers you run by hand. It needs `npm run up:deps` and the sample database, and runs every test at a desktop size and a phone size (Pixel 7):

- `demo.spec.ts`: the blueprint's demo flow. Sign in with the form, connect the sample database through the wizard, ask a question (summary, chart, table), an ambiguous question, an unsafe request the SQL guard refuses, unsafe SQL, then history, usage, and deleting the account.
- `a11y.spec.ts`: axe accessibility checks (WCAG 2.1 A and AA) on every page; serious and critical problems fail.

The worker in these tests runs with `LLM_FAKE=true`: a scripted model (`packages/core/src/llm/scripted.provider.ts`) answers by fixed rules, so everything after the model (guard, executor, chart, summary) is real and the results never vary. `LLM_FAKE` is refused in production. `npm run test:browser:live` is the one exception to "no real model": it asks the real model one question (`live.spec.ts`), needs `GEMINI_API_KEY`, and is run on purpose, never by `test:all`. Building restarts dev servers you have running, because they run from the built files.

The evaluation runner is not created yet. Evaluation reports accuracy. It is not a pass/fail suite, and apart from the live browser test it is the only place a real model is called.

## Rules

- Never call Gemini, or any other live model, from a test. Use `FakeLlmProvider` from `@ayd/core/testing`, which answers from a script and records each request. Real model calls belong in `eval/`; `npm run try-llm --workspace=@ayd/worker` checks a key by hand.
- Each integration test starts from a clean database state. Tests must not depend on rows left by another test.
- Prefer many unit tests, fewer integration tests, and a short browser suite that covers the demo flow only.
- Safety code gets the heavy coverage: the SQL guard, the SSRF guard, authorization, encryption, and read-only execution. There is no global coverage percentage. `@ayd/ssrf-guard` and `@ayd/crypto` are unit-tested with no network.
- Security cases are data-driven. One attack string is one line in a file under the package that owns the check, so a new case does not need a new test function.
- Shared fakes and factories go in `packages/test-utils` when a second app needs them. Until then, a fake can live next to the test that uses it.
- API unit tests build their environment with `testEnv()` and HTTP tests their app with `createHttpApp()`, both in `apps/api/src/testing/`. `@ayd/core` keeps its test helpers (`coreTestEnv()`, `MemoryCoordination`, the in-memory rate limiter, daily quota, usage counters, and audit writer, and the in-memory connection and schema repositories) in `packages/core/src/testing/`, excluded from its build. The API's Jest configs and `tsconfig.json` map `@ayd/core/testing` to that folder's source. `createHttpApp()` provides the real limits over the in-memory limiter and quota, so a test can pass small limits through `testEnv()` and reach them. HTTP tests replace the queue with `InlineJobQueue`, which runs each job at once through the real `JobProcessor` (`inlineJobProviders()` in `apps/api/src/testing`). Files in that folder import runtime classes from `@ayd/core`, not relative paths, so they share the classes the app loads from core's build. The in-memory fakes of the repositories and of Redis coordination live there too, and the whole folder is excluded from the production build.
- Every in-memory fake of a repository must behave like the real one. `test/integration/auth-repository.int-spec.ts` runs one contract against both auth repositories. Follow that pattern when a fake carries security rules.
- A fake `pg` client cannot prove a privilege rule. Tests that depend on how PostgreSQL resolves grants use `apps/api/test/helpers/scratch-database.ts`, which creates a throwaway database and suffixed roles on the `DATABASE_URL` server and drops them afterward. Its `plainClients` and `plainPools` factories turn SSL off for that server, which has no TLS.

## CI

On every push: lint, format check, unit tests (including the web app's), and build (including the web app).

On every push, in a second job: migrate a Postgres service, then integration and API end-to-end tests.

Browser tests run locally for now (the user's choice); a CI job needs the whole stack started in GitHub Actions and comes with the deployment work. Evaluation runs when `eval/` exists, on a schedule and when prompts or models change.
