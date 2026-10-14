# AI review: comparison with the assignment brief, and extra.md

Date: 2026-10-14
Base commit: `afbc0d3` (test: add browser tests and an accessibility pass, completing Phase 9)

## What changed

Docs only. No code changed.

- **`docs/extra.md` (new, at the user's request):** what the project does beyond the assignment brief, and where it meets a requirement more strictly. Each item points to code or an ADR; it ends with test counts as last run.
- **`docs/features.md`:** a "Still open against the assignment brief" list (API documentation, DTO validation, the evaluation dataset, deployment instructions), plus the blueprint items not built yet.
- **`docs/README.md`:** `extra.md` added to the index.

## AI usage

An AI assistant (Claude Code) compared the brief and the blueprint with the repository, checked uncertain items in the code before writing them down, and wrote both documents.

## Problems found during this change

Two claims in the first draft of `extra.md` were wrong, and were corrected before commit:

1. **It cited ADR 0003 for sign-in.** ADR 0003 is about separate API and worker processes. The reference now points to `apps/api/src/auth`.
2. **It said integration tests cover cross-user access for every area.** The coverage is spread across HTTP, service, and integration tests. The wording now says so.

## What was checked

These were checked in the code rather than assumed:

- **No Swagger, class-validator, helmet, or CORS configuration.**
- **No question-and-SQL example pairs in the prompt.** It has formatting examples only.
- **`rewrapCredentials` exists and is tested,** but no background job uses it.
- **No circuit breaker per model provider;** there is a fallback chain.
- **Readiness checks** cover the app database and Redis only.
- **No partitions or retention, no data export, and no `eval/` folder.**
- **Connection routes have no submission rate limit.**
- **14 ADRs exist.**

Prettier passes. No tests were run, because no code changed.

## Still open

- **The four brief gaps listed in `features.md`.** The evaluation dataset and the deployment instructions are expected deliverables in the brief.
