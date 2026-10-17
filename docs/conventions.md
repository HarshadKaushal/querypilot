# Conventions

The patterns this codebase follows, so new code looks like the code around it. Each rule says why it exists.

When this page and the code disagree, the code is right; fix this page. Step-by-step checklists for adding a table, a route, or a screen are at the end of [implementation.md](implementation.md#how-to-extend-this).

## Where code lives

| Kind of code                                                                              | Where                                                  | Why                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| HTTP: routes, guards, request DTOs, response docs                                         | `apps/api/src/<feature>/`                              | Only the API speaks HTTP.                                                |
| Work both processes need (connections, schema, jobs, the ask pipeline, the model, limits) | `packages/core/src/<area>/`                            | The API and the worker share it without importing each other (ADR 0006). |
| Pure checks with no Nest or database                                                      | `packages/sql-guard`, `ssrf-guard`, `crypto`, `shared` | Small, fully tested, and easy to read alone.                             |
| Tables                                                                                    | `packages/database` (models, types, enums, migrations) | One place owns the schema (ADR 0004, ADR 0015).                          |
| Screens                                                                                   | `apps/web/src/features/<feature>/`                     | A reader can follow a button to the URL it calls (ADR 0014).             |

Packages are imported as `@ayd/<name>` and run from their built `dist/` folder. After changing a package, run `npm run build` before running the app or tests that use it.

## File names

| Suffix                           | Holds                                                                                 | Example                                      |
| -------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------- |
| `*.module.ts`                    | A Nest module: what it provides and imports                                           | `connections.module.ts`                      |
| `*.controller.ts`                | HTTP routes only; no business rules                                                   | `jobs.controller.ts`                         |
| `*.service.ts`, `*.runner.ts`    | Business rules and job steps                                                          | `connection.service.ts`, `ask-job.runner.ts` |
| `*.repository.ts`                | The storage interface and its injection token                                         | `connection.repository.ts`                   |
| `sequelize-*.repository.ts`      | The Sequelize implementation of that interface                                        | `sequelize-connection.repository.ts`         |
| `*.dto.ts`                       | What a client **sends**, validated by class-validator                                 | `connection.dto.ts`                          |
| `*.responses.ts`                 | What a client **gets back**; for the Swagger docs only                                | `connection.responses.ts`                    |
| `*.model.ts`                     | A Sequelize model (`packages/database`)                                               | `user.model.ts`                              |
| `*.spec.ts(x)`                   | A unit test, beside the file it tests                                                 | `chart-summary.spec.ts`                      |
| `*.http.spec.ts`                 | A unit test that sends HTTP requests to the Nest app, with fakes instead of databases | `jobs.http.spec.ts`                          |
| `*.int-spec.ts`, `*.e2e-spec.ts` | Tests against real Postgres and Redis                                                 | see [testing.md](testing.md)                 |

## Comments

- **Every file says what it is for**, in two to four plain sentences: a JSDoc on its main class or function, or a `//` block after the imports. Say what the file owns and, when it matters, what it deliberately does not do.
- **Comments explain why, not what.** `// Fail fast instead of queueing commands while Redis is down` is useful; `// create a Redis client` is not.
- **Name a number when it means something.** For example `IV_BYTES = 12`, `PIE_MAX_ROWS = 5`, `SQLSTATE.QUERY_CANCELED`. Put a comment above it saying where the value comes from.
- **References** such as "ADR 0011" or "blueprint 9.5" point to `docs/adr/` and `docs/blueprint.md`.

## Errors

There are two kinds of failure. Each has one way through the code.

1. **A request that cannot be served.** Throw an `AppException` (`packages/core/src/errors/app.exception.ts`) with a stable code from `@ayd/shared` and a message written for the user. Helpers: `notFound()` (also for someone else's id, so the two look the same), `invalidRequest()`, and `tooMany()`. `AllExceptionsFilter` turns every error into `{ error: { code, message, requestId } }`. Anything that is not an `AppException` becomes a fixed message, so database or library text never reaches the client.
2. **An expected failure inside a job.** Return `{ ok: false, error: JobError }`; do not throw it. `packages/core/src/jobs/job-errors.ts` converts exceptions, model errors, and executor failures. Throwing is reserved for bugs, and BullMQ retries those.

Messages are always written in this codebase. Never pass on a message from PostgreSQL, Gemini, or Google. Decide on their error **codes** instead (see `user-database/sqlstate.ts` and `connect-error.ts`).

## Validation

- **Request bodies** are DTO classes checked by the global `ValidationPipe` (`apps/api/src/common/validation.ts`) before the controller runs. Undeclared fields are dropped. A failure is a 400 `VALIDATION_ERROR` naming the field.
- **Decorators run from the bottom up.** Put the type check (`@IsString()`, `@IsArray()`) closest to the property. Otherwise a number may be reported as "too long".
- **Business rules stay in the core services** (lengths, SSL mode, the allowlist against the snapshot), because the worker calls those services too, without HTTP.
- **The web app repeats some limits** (for example `validateConnection` in the connect wizard) so mistakes show per field before anything is sent. The server's check is the one that counts.

## Dependency injection and storage

- **Storage behind an interface.** A service depends on an interface plus a `Symbol` token (`CONNECTION_REPOSITORY`), not on Sequelize. The module provides the Sequelize class, and unit tests provide an in-memory one (`packages/core/src/testing/`, `apps/api/src/testing/`).
- **Transactions.** Pass `{ transaction }` to every query inside `db.transaction(async (transaction) => ...)`. A query without it runs outside the transaction and is not rolled back.
- **Audit rows for a change** are written in the same transaction as the change.

## The web app

- **Requests:** every `/v1` URL is in a feature's `api.ts`. Reads are TanStack Query hooks (`useConnections()`); changes are functions that take the API client.
- **Worker jobs:** start one with `useJobRunner()` (`lib/use-job-runner.ts`). Do not keep job state by hand.
- **Forms:** use `useForm` from `@mantine/form` for several fields with validation, and `useState` for a single input.
- **Errors on screen:**
  - `ErrorAlert` for a failed load or request;
  - `FailureView` for a failed question or query, with a title per error code;
  - `notifyError()` for a failed action such as a delete.
- **Imports across features** go through the feature's `index.ts`.

## Known inconsistencies

The patterns below differ from file to file. They work, and they were left as they are on purpose (2026-10-18) because changing them touches many files. Do not copy the odd one out. When you change one of these files, moving it to the more common pattern is welcome.

- **Result shapes:**
  - Most results use `{ ok: true | false }`.
  - `SqlCheckResult` uses `allowed`, `UpdatePlan` uses `check`, `SqlRun` uses `ran`, and a few results are plain strings.
- **Repository layout:**
  - `connections/` and `schema/` split the interface and the Sequelize class into two files.
  - `history/query-history.ts` and `ask/proposal-cache.ts` keep both in one file.
- **Audit writes:**
  - Some repositories have a `writeAudit` method.
  - `JobProcessor` uses `AUDIT_WRITER`.
  - `SequelizeQueryHistory` calls `writeAuditLog` directly.
- **Names that say less than they could:**
  - `upsertGoogleUser`: dev login uses it too.
  - `ProbeRequest`: it is the resolved target for any connection, not only probes.
  - The SQL guard helpers: `fields` asserts the allowed keys, `str` and `list` validate, and `show` truncates.
  - `AuthService.reuse()`: it revokes a token family.
- **File names:** both singular and plural are used (`connection.dto.ts` but `jobs.dto.ts`).
- **One concept, three names:**
  - "Send sample rows to the model" is `sendSampleRowsToLlm`, then `rowsAllowed`, then `{ labels }`.
  - The proposal cache is `ProposalCache`, model `QueryCacheEntry`, and table `query_cache`.
