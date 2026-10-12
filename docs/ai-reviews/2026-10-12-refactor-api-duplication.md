# AI review: remove duplicated code in the API

Date: 2026-10-12
Base commit: `8735a37` (fix: reset the schema when a connection moves, name schema drift, widen the setup SQL)

## What changed

A behavior-preserving refactor of `apps/api/src`, plus contract tests for the auth repositories.

- **Audit writing.** The same `auditLog.create` body was in all three Prisma repositories, with three different inline input types. `audit/audit-log.ts` now holds the one `AuditEntry` type and the one `writeAuditLog` function. The repositories delegate to it.
- **Error responses.** "Not found" was built three times and "request was not valid" six times. `common/errors/app.exception.ts` now has `notFound()`, `invalidRequest(message?)`, and the four fixed client messages, which `AllExceptionsFilter` reuses. The services create a fresh exception per throw instead of sharing module-level instances. The unused `dependencyUnavailable()` helper is removed; the `DEPENDENCY_UNAVAILABLE` code stays in `@ayd/shared`.
- **Mappings.** The user mapping lived in both auth repositories, and the connection mapping in both connection repositories and in the service's `strip`. Now there is one `toPublicUser` and one `toPublicConnection`, next to their interfaces.
- **Schema repository.** The `FOR UPDATE` row lock, the delete-and-insert of allowlist rows, and the 30-second transaction timeout each appeared twice. Each is now one named helper or constant. The SQL and the transaction boundaries are unchanged.
- **Error logging.** `safeErrorDetail` now includes the error's SQLSTATE or Node code, replacing three call sites that added it by hand. `errorCode` moved to `common/errors` so common logging does not depend on the executor.
- **Probe SQL.** The "roles the login can act as" clause (4 uses) and the system-schema filter (3 uses) are named constants. The generated SQL is the same text.
- **AuthGuard.** A block that ran the same token check twice for an empty token is removed. An empty token is still `UNAUTHENTICATED`.
- **Comments.** Added for refresh-token reuse and concurrent claims, HS256 verification and the constant-time comparison, the sealed OAuth cookie, and the new helpers.
- **Contract tests.** `test/integration/auth-repository.int-spec.ts` runs one suite against both `MemoryAuthRepository` and `PrismaAuthRepository`: user upsert, refresh storage, single-use claims, expired and revoked claims, family revocation, logout, and account deletion. It found that the in-memory fake kept a deleted user's refresh tokens, revoked, where the database deletes them. The fake now deletes them.

## AI usage

An AI assistant (Claude Code) inspected the repository, chose what to consolidate, wrote the changes and the contract tests, and ran the checks, at the developer's request for a repository-wide cleanup. Per the repository's CLAUDE.md, bugs found during the review are reported, not fixed.

## Suggestions accepted

- One audit writer now. A full Audit module is left for the Phase 8 audit work, where it gets more callers.
- Error factories instead of shared exception instances.
- Contract tests as the guard against fakes drifting from the real repositories.

## Suggestions rejected

- Merging the API's and worker's environment parsers and Redis wrappers. ADR 0006 plans that for `packages/core` at the start of Phase 6, so doing it now would be churn.
- Merging the in-memory repositories' small ownership checks. They are one line each.
- Interpolating constants into more of the probe's SQL. Only rules that must stay identical everywhere were named.
- Fixing the bugs listed below. They change behavior and wait for a decision.

## Decisions

- `safeErrorDetail` adding `code` changes log lines only: one extra field, which is not a secret.
- `INTERNAL_ERROR_MESSAGE` and `UNAUTHENTICATED_MESSAGE` keep their exact text, so API responses are byte-for-byte the same.

## What was checked

- `tsc --noUnusedLocals --noUnusedParameters` across the API, the worker, and the four packages found nothing unused before the refactor. ESLint caught the imports the refactor left unused, and they were removed.
- Unit tests in every workspace: API 208, guard 309, others unchanged. Integration: 59 (45 before, plus 14 contract checks). End-to-end: 3. ESLint, Prettier, the full build, and the API type check pass.
- The concurrency, stale-save, and moved-connection integration tests pass on the refactored row-lock helper.
- Live `npm run try-query` against the sample database returned the region counts, and refused `customers.email`.

## Still open (found during the review, not fixed)

1. `readCookie` calls `decodeURIComponent` on the raw cookie value. A malformed `%` sequence throws `URIError`, so `POST /v1/auth/refresh` answers 500 instead of 401.
2. `AuthService.refresh` claims the old token, then inserts the new one, in two separate writes. If the insert fails, the old token is used up and the user is signed out.
3. `deleteAccount` writes the `account.deleted` audit row before deleting the user, not in one transaction. If the delete fails, the audit says it happened.
4. `requestMeta` records `request.ip`, which behind a proxy or load balancer is the proxy's address unless Express's `trust proxy` is configured. This is a deployment concern for Phase 12.
