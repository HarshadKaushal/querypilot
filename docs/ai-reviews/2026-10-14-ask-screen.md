# AI review: the ask screen (Phase 9 step 9c)

Date: 2026-10-14
Base commit: `2e15555` (fix: reconnect a job stream that goes silent)

## What changed

All changes are in `apps/web` and the docs. The API is unchanged.

- **`/ask`, now the page after sign-in, and first in the menu:**
  - choose a connection;
  - write a **question** or **SQL** (the guarded raw-SQL route the user chose to keep), checked against the API's limits (2,000 and 20,000 characters);
  - `Ctrl+Enter` submits;
  - live stages, and **Cancel** (`POST /v1/jobs/:id/cancel`);
  - up to three example questions from the allowed tables (`pages/examples.ts`): a count, a count per related row from a foreign key, and a count per month from a date column.
- **`components/answer/`:**
  - **`AnswerView`:** the summary (marked when it was written from the numbers rather than by the model), the chart, the rows, the SQL with a copy button and the assumptions, and badges for a cached answer, a re-read schema, time, tokens, and model.
  - **Ambiguous and unanswerable answers** say nothing ran, and offer to edit the question.
  - **`QueryResultView`:** SQL the user wrote, with rows and SQL only.
  - **`ResultChart`:** draws the server's `ChartSpec` (stat, line, bar, pie) with Mantine charts on Recharts. It converts number strings, and loads only when an answer has a chart.
  - **`ResultTable`:** sortable by any column (numbers by value, empty cells last) and virtualised above 100 rows. Empty and truncated results get their own messages.
  - **`FailureView`:** a title per failure code: refused for safety (with the guard code), write blocked, not permitted, timeout, schema changed, connection down, busy, or paused, schema not read (linking to the connection page), model not set up or unavailable, rate limit, daily quota (with the wait from `Retry-After`), too many jobs, and cancelled.
- **Packages:** `@mantine/charts` 9.7.2, `recharts` 3.10.1, `@tanstack/react-virtual` 3.14.19.
- **Test setup:** a stand-in for `document.fonts`, which jsdom lacks.
- **Docs:** ADR 0014 (answers), implementation (step 9c), features, and the README (Gemini key; don't run tests or builds while using the app).

## AI usage

An AI assistant (Claude Code) planned the step from blueprint section 16, checked the answer and chart shapes in the server code, and wrote the code, tests, and docs.

## Suggestions accepted

- **The server chooses the chart; the page only draws it**, so a result always looks the same (ADR 0012).
- **One title per failure, with the API's message under it**, so each state the blueprint lists has a designed message without copying server text.
- **Loading the chart code lazily.** It cut the first download from 334 kB to 208 kB compressed.

## Suggestions rejected

- **Virtualising every table.** In jsdom, a virtualised table draws no rows, and for under 100 rows it buys nothing. Small results render plainly.
- **A chart for SQL the user wrote.** The server does not choose one for `query.run`, and the page does not invent one.

## Decisions

- **The examples are templates over table names and keys**, not model calls, so they cost nothing and cannot leak data.
- **Cancel only asks.** The followed job ends as `cancelled` through the stream, as the API reports it.

## Problems found during this change

1. **Mantine's auto-growing text box crashed in tests:** jsdom has no `document.fonts`. Nine ask-page tests could not find the question box until a stand-in was added to the test setup. Browsers all have it.
2. **The bundle grew to 1.1 MB (334 kB compressed)** with the chart library. Lazy loading split it to 678 kB plus 450 kB for the chart. Vite still warns that the main file is over 500 kB before compression.
3. **Lint warns** that TanStack Virtual cannot be optimised by the React Compiler. This project does not use the compiler, so the warning has no effect.

## What was checked

- **Web unit tests:** 58 (17 new).
  - **Helpers:** number parsing, sorting, chart points, wait wording, examples.
  - **Ask page:**
    - an answered question (summary, rows, row count, SQL, assumptions);
    - sorting;
    - examples filling the box;
    - ambiguous; unanswerable;
    - refused for safety with the guard code;
    - the daily quota with "about 2 hours";
    - SQL mode with truncation;
    - cancel;
    - no connections.
- **Manual check through the Vite dev server**, with the real API, worker, Gemini, and sample database (a throwaway user, removed afterwards):
  - **A question:** every stage in order; answered with 4 rows, a pie chart, and a model summary that named no region because sample rows were off.
  - **"Delete all the orders":** unanswerable, nothing ran.
  - **`SELECT count(*) FROM orders`:** 8, rewritten to `public.orders LIMIT 1001`.
  - **`DELETE FROM orders`:** `SQL_REJECTED (not_select)`.
  - **Usage:** 2 of 50 questions.
- **Other checks:**
  - `tsc`, `vite build`, ESLint (one warning, above), and Prettier pass;
  - the other workspaces are unchanged and were not run again.

## Still open

- **The main bundle is 678 kB before compression.** Splitting pages by route can come with the last step.
- **The model sometimes calls a write request "unanswerable"** rather than producing SQL for the guard to reject. Either way nothing runs; the guard is the backstop, as the SQL test showed.
- **Carried over:** history, usage, and settings (9d), Playwright tests, the accessibility pass, copied response types, and CORS and CSRF configuration (Phase 10).
