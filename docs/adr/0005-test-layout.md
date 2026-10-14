# ADR 0005: Where tests live

Unit tests are `*.spec.ts` beside the source file and run with no Docker. Integration tests are `*.int-spec.ts` under `apps/<app>/test/integration/`. API end-to-end tests are `*.e2e-spec.ts` under `apps/api/test/e2e/`. Browser tests live in `e2e/` (Playwright), with their own config, servers, and job queue. Model-quality runs will live in `eval/` and are not part of the pass/fail suite. See [testing.md](../testing.md).
