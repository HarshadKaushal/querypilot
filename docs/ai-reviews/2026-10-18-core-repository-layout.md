# AI review: every core storage area in two files

Date: 2026-10-18
Base commit: `71d7f3b` (refactor(database): one folder per table for models, types, and enums)

## What changed

Four storage areas in `packages/core` mixed their interface and their Sequelize queries in one file. They now use the same two-file shape as `connections/` and `schema/`. No behaviour changed, and every exported name is the same, so `apps/api` and `apps/worker` did not change.

| Before                                           | After                                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `history/query-history.ts` (+ `.spec.ts`)        | `query-history.repository.ts`: the types, `QueryHistory`, `QUERY_HISTORY`, `historyEntryFor`, and the cursor helpers, with the spec renamed beside it. `sequelize-query-history.repository.ts`: `SequelizeQueryHistory`. |
| `ask/proposal-cache.ts`                          | `proposal-cache.repository.ts`: `CachedProposal`, `ProposalCache`, `PROPOSAL_CACHE`, `normalizeQuestion`, and `questionKey`. `sequelize-proposal-cache.repository.ts`: `SequelizeProposalCache`.                         |
| `limits/usage-counters.ts`                       | `usage-counters.repository.ts`: the types and `USAGE_COUNTERS`. `sequelize-usage-counters.repository.ts`: `SequelizeUsageCounters`.                                                                                      |
| `audit/audit-log.ts` and `audit/audit-writer.ts` | `audit.repository.ts`: `AuditEntry`, `AuditWriter`, and `AUDIT_WRITER`. `sequelize-audit.repository.ts`: `writeAuditLog` and `SequelizeAuditWriter`.                                                                     |

- **Importers updated:** `jobs.module.ts`, `job-processor.ts` and its spec, `history.module.ts`, `ask-job.runner.ts`, the connection and schema repositories, three `testing/memory-*` fakes, and `src/index.ts`. Each of the four new Sequelize files has a short comment saying what it stores.
- **Docs:**
  - `conventions.md` drops the "Repository layout" inconsistency. It gains the two-files rule, a four-layer list (table, repository, service, controller), and "no pass-through services".
  - `implementation.md` and `request-flow.md` have the new paths.

## AI usage

An AI assistant (Claude Code) did the following:

- found the four mixed files and every importer;
- split the files with `git mv` plus line ranges, so each half kept its code unchanged;
- rewrote the import lines with `sed`;
- wrote the two audit files by hand, because their halves crossed over.

## Suggestions accepted

- **Make every core area consistent,** chosen by the user (2026-10-18).
- **Name the files after the existing pattern** (`*.repository.ts`, `sequelize-*.repository.ts`), not a new one.

## Suggestions rejected

- **Adding `HistoryService`, `UsageService`, and similar wrappers.** These areas have no rules beyond storage. The history and usage controllers, `AskJobRunner`, and `JobProcessor` inject the repository token directly (checked with a search). A wrapper would only pass the calls through.
- **Merging the audit writes in this commit.** The "Audit writes" inconsistency in `conventions.md` (`writeAudit` methods, `AUDIT_WRITER`, and a direct `writeAuditLog`) is unchanged. It would change call sites and transaction handling, not only file names.

## Decisions

- **The `audit/` files are named `audit.repository.ts` and `sequelize-audit.repository.ts`,** after the area, because they hold both `AuditWriter` and the shared `writeAuditLog`.

## Problems found

- None.

## What was checked

- `npm run build`, after deleting `packages/core/dist`: passed for every workspace. `dist/history` and `dist/audit` hold only the new files.
- **A runtime check of the built `@ayd/core`:** all 15 moved names (classes, tokens, and helpers) are exported.
- `npm run lint`: passed, with the one known warning.
- `npm run format:check`: clean apart from the other session's untracked `docs/sequelize.md`.
- `npm test`: API 112, web 72, worker 6, core 293, sql-guard 310, ssrf 25, crypto 4, shared 4, all passed. It exits 1 on the known sql-guard coverage threshold.

## Still open

- **`npm run test:int` was not run** (Docker Desktop stopped). It is the test that runs `SequelizeQueryHistory`, `SequelizeProposalCache`, `SequelizeUsageCounters`, and the audit writes against real Postgres.
