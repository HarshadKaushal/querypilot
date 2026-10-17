# @ayd/api

The HTTP API (NestJS). It signs users in, validates requests, checks ownership and limits, reads and writes the app database, and queues jobs for the worker. It never opens a customer's database and never calls the model: that is the worker's job (ADR 0003).

**Start reading at**

- `src/main.ts`: start-up, plus what every request goes through (the logger, the error filter, and validation).
- `src/app.module.ts`: every feature module.
- `src/jobs/jobs.controller.ts`: asking a question. Follow it with [docs/request-flow.md](../../docs/request-flow.md).

**Folders.** There is one folder per feature: `auth/`, `connections/`, `schema/`, `sql-guard/`, `jobs/`, `history/`, `usage/`, `users/`, `health/`, `egress/`, and `limits/`. Each holds a controller, a module, `*.dto.ts` (request bodies, validated), and `*.responses.ts` (response docs). `common/` holds the error filter, validation, Swagger helpers, and request metadata. `testing/` holds the fakes the unit tests use.

**Commands** (from the repository root):

```powershell
npm run dev                         # tsc --watch plus node --watch, on :3000
npm run test:unit -w @ayd/api       # unit and HTTP tests, no Docker
npm run test:int -w @ayd/api        # needs npm run up:deps and migrations
npm run test:e2e -w @ayd/api
```

Swagger UI is at http://localhost:3000/docs outside production.
