# ADR 0013: Query history and quotas

Phase 8 keeps a record of what each user asked and limits how much they can ask.

**History (step 8a).** The `queries` table holds one row per finished `question.ask` or `query.run` job, keyed by the job id: the question or SQL, the SQL that ran (as the guard rewrote it), the status (`answered`, `ambiguous`, `unanswerable`, `failed`, `cancelled`), the error code, row count, truncation, schema version, whether the answer came from the cache, the summary, the models, tokens, and timings. It has no column for result rows (an integration test checks the table's columns), so history never holds rows. The worker's `JobProcessor` writes the entry when a job finishes, including cancellations, and a job given up after its last crash is recorded as failed. A failed write is logged and never fails the job; a retried job writes the same id again.

**Reading history.** `GET /v1/history` lists the owner's entries newest first, 20 by default and 50 at most, with keyset pagination: the cursor is the last entry's time and id, and the next page reads entries older than it, so pages stay fast and do not shift when new entries arrive. `GET /v1/history/:id` shows one entry. `DELETE` removes one or all. Every read and delete is filtered by the owner; another user's id is NOT_FOUND. Entries go with their connection or account.

**Re-run.** `POST /v1/history/:id/rerun` replays the stored SQL as a new `query.run` job (the user's choice): fresh rows, no model call. The worker runs it through the guard again, so a schema or allowlist change since then is caught. An entry with no SQL (ambiguous, unanswerable, failed before SQL ran) cannot be re-run.

**Summaries and row values.** History keeps the summary, so the summary must not carry row values the owner did not allow out. When the connection's `sendSampleRowsToLlm` is off, the facts behind the summary hold only column names, the row count, and numeric totals, minimums, and maximums; the labelled top items, which are row values, are left out, so neither the summary model, the template, nor history sees them (fixed in step 8a after the history test found a label in a template summary).

**Quotas and rate limits** (step 8b) follow in this ADR when built.
