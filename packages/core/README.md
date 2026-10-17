# @ayd/core

The Nest modules and helpers that the API and the worker share (ADR 0006). Nothing here speaks HTTP. Most of the business logic lives here.

**Start reading at**

- `src/ask/ask-job.runner.ts`: answering a question, from the model to the guard, the database, and the summary. Follow it with [docs/request-flow.md](../../docs/request-flow.md).
- `src/jobs/job-processor.ts`: how a job is sent to its runner and recorded in history.

**Folders**

| Folder                                                  | What it owns                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ask/`                                                  | The question pipeline: prompt, SQL proposal, proposal cache, chart, facts, and summary                                         |
| `jobs/`                                                 | The queue (`JobQueue`), the worker loop, the job types, cancellation, live events, and the runners for SQL and connection jobs |
| `connections/`                                          | Connections: validation, sealed credentials, the SSRF check, and the read-only check                                           |
| `schema/`                                               | Schema snapshots and the allowlist (what the AI may see)                                                                       |
| `sql-guard/`                                            | Runs `@ayd/sql-guard` against a connection's allowlist                                                                         |
| `user-database/`                                        | The only code that connects to a customer's database: the probe, introspection, and the executor                               |
| `llm/`                                                  | The model client, with fallback, plus Gemini and the scripted provider for tests                                               |
| `history/`, `limits/`, `audit/`                         | Query history, rate limits and quotas, usage counters, and the audit log                                                       |
| `database/`, `redis/`, `config/`, `logging/`, `errors/` | Connections to the app database and Redis, environment checks, logs, and `AppException`                                        |
| `testing/`                                              | In-memory fakes for unit tests. These are not part of the build.                                                               |

`src/index.ts` re-exports everything the apps import as `@ayd/core`.

**Commands:** `npm run build -w @ayd/core` and `npm run test:unit -w @ayd/core`. The apps run from `dist/`, so rebuild after a change.
