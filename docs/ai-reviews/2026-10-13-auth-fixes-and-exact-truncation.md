# AI review: auth atomicity fixes, malformed cookies, exact truncation

Date: 2026-10-13
Base commit: `aecbfdf` (refactor: rename unclear API folders and move test fakes into src/testing)

## What changed

Step 1 of the Phase 6 plan: the open bugs from the refactor review, plus two findings from earlier questions.

1. **Malformed cookie gave 500.** `readCookie` called `decodeURIComponent`, which throws `URIError` on bad percent-encoding such as `%E0%A4%A`. A malformed cookie is now treated as no cookie, so refresh answers 401.
2. **Refresh rotation was two separate writes.** The service claimed the old token, then inserted the new one. A failure between them left the old token used with no replacement, which signed the user out. `claimRefresh` is replaced by `rotateRefresh(oldId, next, now)`, which does both in one transaction. The losing side of a race writes nothing.
3. **Account deletion wrote its audit row outside the delete.** The audit row could be written and the delete fail, or the reverse. `deleteUser(userId, audit)` writes both in one transaction. The audit row survives the delete with `user_id` set to null, because of the existing `ON DELETE SET NULL`.
4. **Truncation is exact.**
   - Before: the guard wrote `LIMIT 1000`, so the executor could not see a 1,001st row. It marked any guard-capped result with exactly 1,000 rows as cut, even when nothing was missing.
   - Now: the guard writes `LIMIT cap + 1`. The executor keeps `cap` rows and treats the extra one only as the signal that the result was cut.
   - The `guardLimitApplied` workaround is removed. A LIMIT the user wrote at or under the cap is kept, as before.
5. **Finding A, documented only.** ADR 0010 now explains that a running query's `ACCESS SHARE` lock makes the customer's `DROP` or `ALTER TABLE` wait, and that their own queries queue behind it. Customers should set `lock_timeout` on migrations.

## AI usage

An AI assistant (Claude Code) wrote the fixes and tests, ran the checks, and live-tested the truncation boundary.

## Suggestions accepted

- Move each pair of writes into the repository as one transactional method, not a transaction in the service. The interface stays storage-neutral, and the in-memory fake mirrors it.
- Extend the existing contract test so both repositories prove the new rules: rotation stores the replacement only on success; deletion keeps the audit row with a null user id.
- `LIMIT cap + 1` instead of keeping a "possibly truncated" label.

## Suggestions rejected

- Catching `URIError` in the controller. The cookie parser is the right place, and every caller gets the fix.
- Hiding the `+ 1` from the SQL check endpoint's output. The endpoint returns the SQL that will run, and `rowCap` beside it. Showing different SQL from what runs would be worse.

## Decisions

- **Request IP behind a proxy** (Express `trust proxy`) is left for Phase 12, where the proxy is known.
- **Finding B** (a column type change reported as `QUERY_INVALID`) is left for Phase 7's self-healing.

## What was checked

- New tests:
  - A malformed refresh cookie answers 401 (HTTP test).
  - Rotation is single-use and stores the replacement only on success, and an expired or revoked token gets no replacement (contract test, both repositories).
  - Deletion keeps its audit row with a null user id (contract test, both repositories).
  - Exactly-the-cap results are complete and cap-plus-one results are cut (executor unit tests).
  - `LIMIT 1001` is kept as written (guard).
- Unit tests (API 210, guard 310, other packages), integration 59, end-to-end 3, ESLint, Prettier, and the build all pass.
- Live boundary check with the 5-row sample table:
  - `SQL_ROW_CAP=5`: `LIMIT 6`, 5 rows, complete.
  - `SQL_ROW_CAP=4`: `LIMIT 5`, 4 rows, cut by the rows cap.

## Still open

- Request IP behind a proxy: Phase 12.
- Finding B: Phase 7.
