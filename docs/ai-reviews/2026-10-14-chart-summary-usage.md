# AI review: chart, grounded summary, and usage (Phase 7 steps 4 and 5)

Date: 2026-10-14
Base commit: `e1821d6` (feat: cache validated SQL proposals and heal once on schema changes)

## What changed

An answered question now returns more than rows (blueprint 9.8 to 9.10).

- **`ask/chart.ts` — `selectChart`:** fixed rules on column types and row counts; no model involved.
  - One number: a stat card.
  - A date then numbers: a line, thinned to 200 points while keeping the first and last.
  - A label and one non-negative number over 2 to 5 rows: a pie.
  - A label and numbers, up to 50 rows: bars.
  - Anything else: the table.
- **`ask/facts.ts` — `computeFacts`:** row count, truncation, min, max, total, and average per number column, and the top 5 label and value pairs.
- **`ask/summary.ts` — the summary model call.**
  - It receives the question and the facts, plus up to 20 rows only when the connection's `sendSampleRowsToLlm` is on (the user's rule).
  - `summaryIsGrounded` keeps the model's summary only if every number in it appears in the facts, the rows shown, or the question.
  - `templateSummary` is used otherwise, when the call fails, and for zero rows.
- **`AskJobRunner`:** adds the `summarizing` stage, and the result fields `chart`, `facts`, `summary { text, source }`, and `usage`. `usage` covers LLM calls, tokens in and out, model milliseconds, query milliseconds, total milliseconds, the models used, and whether a fallback was needed. A summary failure never fails the answer.
- **Docs:** ADR 0012, features, implementation, and the README.

## AI usage

An AI assistant (Claude Code) wrote the chart rules, facts, summary, number check, accounting, and tests. No live model was called.

## Suggestions accepted

- **Rows to the model only when the connection allows it** (the user's choice for this phase). With the setting off, Google sees only column names and the server's computed numbers.
- **Deterministic charts.** The same result always gets the same chart, and no tokens are spent choosing it.
- **A strict number check, with a template fallback.** A made-up figure never reaches the user.
- **Accounting folded into this step.** The usage totals are a small addition here; "step 5" from the plan needs no separate commit.

## Suggestions rejected

- **Letting the model pick the chart.** It costs tokens and time, can vary between runs, and the blueprint asks for rules.
- **A looser number check, such as allowing any number of 10 or under.** "Top 5" is still allowed when the question says 5, but a model-invented "up 12%" is caught.

## Decisions

- **The summary uses the same model chain as the SQL** (primary, then fallback). It is a separate call because it needs the query's result.
- **Zero rows get the template without a model call.**
- **The chart's `points` are the rows themselves**, or a thinned set for long lines, so the UI needs nothing else.

## Problems found during this change

1. **Tests that counted model calls broke**, because an answered question now also asks for a summary. They now count SQL-proposal calls only.
2. **A test's stand-in connection lacked `sendSampleRowsToLlm`.** It now has it, defaulting to off.

## What was checked

- **Unit tests:** core 267 (251 before this step), of which 16 are new.
  - **Chart rules:** stat, line, pie versus bar, the table fallbacks, and thinning to 200.
  - **Facts:** computed from string numbers and nulls.
  - **Summaries:** grounded and invented numbers, numbers from the question and from rows, rows shown only when passed, and the template wording.
  - **Runner:** facts-only versus rows-allowed prompts, an invented number replaced, the template when the summary model fails, and usage totals.
- **Other suites:** API 79, worker 5, guard 310, integration 82, and end-to-end 3 pass. ESLint, Prettier, and the build pass.

## Still open

- **Phase 8:** store each question's metadata and `usage` in the `queries` history table, plus quotas.
- **Frontend:** draw `chart` and show `summary`.
- **A live run with Gemini**, once the key is in `.env`.
