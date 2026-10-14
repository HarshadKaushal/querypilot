# AI review: ask pipeline (Phase 7 step 2)

Date: 2026-10-14
Base commit: `0231de7` (feat: add the model layer with Gemini and a fallback chain)

## What changed

Questions in English now become answers (blueprint section 9, steps 1 to 7).

- **API.** `POST /v1/connections/:id/questions {question}` checks the question (non-empty, at most 2,000 characters, trimmed) and the caller's ownership of the connection, then queues `question.ask` and answers 202.
- **Pipeline (`AskJobRunner`, core).**
  - **Schema:** reads the allowlisted schema. An empty allowlist is `SCHEMA_NOT_READY`, with a message pointing to the allowlist.
  - **Prompt:** builds it (`prompt.ts`) and asks the model for an `SqlProposal` (Zod: status, sql, assumptions, clarifyingQuestion, explanation).
  - **Stop early:** `ambiguous` and `unanswerable` stop and return their text, so nothing runs.
  - **Guard:** checks the SQL. A rejection goes back to the model with the guard's reason, at most 2 times, and then `SQL_REJECTED`.
  - **Run:** resolves the connection and runs the guard's SQL. `QUERY_INVALID` gets one more model attempt, with fixed feedback; other execution errors are returned as they are.
  - **Model failures:** `LLM_NOT_CONFIGURED` or `LLM_UNAVAILABLE`, both new error codes. A cancellation during the model call ends the job as `cancelled`.
  - **Result:** status, question, SQL, assumptions, explanation, rows, schema version, model, and every model attempt.
- **Prompt.**
  - **System prompt:** the guard's rules and its allowed functions. `@ayd/sql-guard` now exports `ALLOWED_FUNCTIONS`.
  - **Schema:** rendered as compact text with types, keys, foreign keys, and descriptions.
  - **Question:** placed in `<question>` tags and declared data.
  - **Large schemas:** trimmed to the tables that share the question's words, plus their foreign-key targets.
- **Jobs.** New kind `question.ask` and stages `loading_schema` and `generating_sql`. `JobProcessor` takes `AskJobRunner`, and `JobRunnersModule` imports `LlmModule`.
- **Fix.** `JobQueue.get` could crash for a job that finished between loading it and reading its state. It now reloads, and a completed state without a result reads as running.
- **Docs:** ADR 0012 (the pipeline), features, implementation, and the README ("Ask a question").

## AI usage

An AI assistant (Claude Code) designed and wrote the pipeline, the prompt, and the tests. Every test uses the scripted fake model; no live model was called (no key is configured yet).

## Suggestions accepted

- **Keep the raw-SQL route** (user's choice, step 7.1). Both routes share the guard and the executor.
- **Ambiguous and unanswerable are successful outcomes** with their own status, not errors. The UI can show a clarifying question instead of a failure.
- **List the guard's functions in the prompt**, to cut rejections and retries.
- **Fixed feedback for `QUERY_INVALID`**, so database error text never reaches the model.

## Suggestions rejected

- **Sending database error text to the model** for a better correction. That text can include values from the customer's data; the executor already turns it into a fixed message.
- **Embedding-based table retrieval.** Keyword overlap with foreign-key expansion meets blueprint 9.3 without another model call or a vector store; it can be swapped in later behind `selectTables`.

## Decisions

- **Prompt budget: 24,000 characters of schema.** Below that, the whole allowlisted schema is sent.
- **The question limit is 2,000 characters.** The raw-SQL route keeps the guard's 20,000.
- **Model attempts are kept in the result.** The accounting step (7.5) will total them; they hold no prompt text.

## Problems found during this change

1. **A race in reading jobs** (above). It was found by the new integration test, whose jobs finish in milliseconds.
2. **An earlier script edit had added `type AskJobRunner` to every import block** in three integration tests, not only the `@ayd/core` one. It was caught while reading one of them, and fixed before running.
3. **A shell `$`/backtick escape** emptied two lines of a new HTTP test. Fixed by editing the file directly.
4. **A wrong expected value in the new integration test** (North has 2 open orders, not 1). The code was right.

## What was checked

- **Unit tests:** core 244, of which 22 are new.
  - **Prompt:** rendering, tags, feedback, the system prompt's rules, and table selection.
  - **Runner:** the full path and its stages; that the model sees only the allowed schema; ambiguous and unanswerable stop early; a guard rejection with its reason, and giving up after 2 rewrites; a single `QUERY_INVALID` retry; no retry for timeouts, permissions, or connection errors; no key; all models failing; fallback on a malformed answer; schema problems; cancellation; a completed job without a result.
- **API tests:** 79, of which 6 are new (questions: 202 with trimming, four invalid bodies, 404).
- **Integration tests:** 81, including 6 new ones through BullMQ with the real guard and executor:
  - an answer with correct rows;
  - the hidden `email` column absent from the prompt;
  - the real guard's rejection reason reaching the second attempt;
  - PostgreSQL's invalid query corrected once;
  - an ambiguous question;
  - no key.
- **Other suites:** end-to-end 3, worker 5, guard 310. ESLint, Prettier, and the build pass.

## Still open

- **A live run with Gemini** once the user adds `GEMINI_API_KEY`.
- **Step 3:** the proposal cache and refresh-and-retry on `QUERY_SCHEMA_CHANGED`.
- **Steps 4 and 5:** chart choice, the grounded summary, and token accounting.
