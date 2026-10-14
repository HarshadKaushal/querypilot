# AI review: proposal cache and schema self-healing (Phase 7 step 3)

Date: 2026-10-14
Base commit: `22777fd` (feat: answer questions in English with the model, the guard, and the executor)

## What changed

**Proposal cache** (blueprint section 7, `query_cache`).

- **Table:** new model `QueryCacheEntry`, migration `20261014120000_query_cache`. It is generated with `prisma migrate diff` against the live database and cascades with its connection.
- **What is stored:** the model's SQL, its assumptions and explanation, and the model name. Never rows.
- **The key:**
  - the connection;
  - the allowlisted schema's fingerprint, which changes with every refresh and allowlist edit;
  - a SHA-256 of the normalized question (lowercased, spaces collapsed, trailing `?.!` dropped).
- **Saving:** a new entry drops the connection's entries for older fingerprints.
- **Interface:** `ProposalCache`, with `PrismaProposalCache` and `MemoryProposalCache` for tests. The cache is wired into `JobRunnersModule` as `PROPOSAL_CACHE`.
- **In `AskJobRunner`:**
  - A hit skips the model but still goes through the guard and the executor.
  - A cached proposal the guard rejects, or that PostgreSQL calls invalid, is dropped, and the model is asked with a clean prompt.
  - Only answered questions are stored, not ambiguous, unanswerable, or failed ones.
  - A failed save never fails the answer.

**Self-healing.**

- **The trigger:** a query fails with `QUERY_SCHEMA_CHANGED`, meaning the database no longer has a table or column the snapshot listed.
- **What happens:** the runner refreshes the schema (stage `reading_schema`), reloads it, and answers once more.
- **When it stops:** a second schema change, or a failed refresh, is returned as it is.
- **Why it is safe:** objects the refresh finds are new, so they stay hidden until allowed; healing cannot widen what the model sees.

**Results** carry `cached` and `schemaRefreshed`.

**Docs:**

- ADR 0012 (cache and healing) and features (this step; the Phase 7 self-healing item is now done).
- Implementation (step 3; Phase 5's Finding B is now handled through cache invalidation).
- `CLAUDE.md` (the user's new rules) is committed separately, with §15 changed at the user's request to keep the docs updated in every change.

## AI usage

An AI assistant (Claude Code) designed and wrote the cache, the healing loop, the migration (Prisma generated the SQL), and the tests. No live model was called.

## Suggestions accepted

- **Keying on the schema fingerprint**, which ADR 0008 prepared for exactly this, so refreshes and allowlist edits invalidate the cache with no separate counter.
- **Re-checking cached SQL with the guard every time.** The cache saves a model call, not a safety check.
- **One refresh-and-retry on a schema change** (planned since Phase 5, Finding B).
- **Keep updating docs with every change** (user's decision, now written into `CLAUDE.md` §15).

## Suggestions rejected

- **Caching the guard's rewritten SQL instead of the model's.** The rewrite depends on the allowlist (`*` expansion, the row cap), so the model's SQL is stored and rewritten on each use.
- **Storing the question text in the key.** A hash keeps the unique index small and the key free of user text.
- **Caching ambiguous and unanswerable answers.** The same words could be clear later, for example after an allowlist edit, which changes the fingerprint anyway.

## Decisions

- **Hits and last use are recorded** (`hits`, `last_used_at`) for later retention or metrics. Nothing expires entries by age yet; old fingerprints are cleaned on save, and deleting a connection removes its entries.
- **The healing refresh writes the normal `schema.refreshed` audit row**, with no IP, since the worker started it.

## Problems found during this change

1. **Escaped characters were lost in shell-written tests twice** (regex `\b` became a backspace character). The lines were replaced by line number. No code effect.
2. **The user replaced `CLAUDE.md` during the step.** §15 forbade changing docs unless asked, which conflicts with updating docs every commit. The user was asked, chose to keep updating them, and asked for the rule to say so.

## What was checked

- **Unit tests:** core 251 (7 new):
  - a repeated question answered from the cache without the model, still through the guard;
  - no caching of ambiguous answers or failures;
  - a cached entry dropped when the guard rejects it, or when PostgreSQL calls it invalid;
  - healing once and answering;
  - returning `QUERY_SCHEMA_CHANGED` after one refresh;
  - returning the refresh's own failure.
- **Integration tests:** 82, including a new real-database test. It answers a question; answers it again from the cache with no model call; renames the column the cached SQL reads; and checks that the job refreshed and asked again, and that the new prompt shows neither the old nor the renamed column.
- **Other checks:** API 79, worker 5, guard 310, and end-to-end 3 pass. ESLint, Prettier, the build, and the migration on the local database all pass.

## Still open

- **Step 4:** chart choice and the grounded summary (rows only when the connection allows it).
- **Step 5:** token and latency accounting.
- **A live run with Gemini**, once the key is in `.env`.
