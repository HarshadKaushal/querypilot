# AI review: a lighter model for summaries

Date: 2026-10-14
Base commit: `b4e5516` (feat: add chart choice, a grounded summary, and usage totals to answers)

## What changed

- A new setting, `LLM_SUMMARY_MODEL` (default `gemini-3.5-flash-lite`).
- `LlmClient` takes an optional second provider list and routes calls whose `purpose` is `summary` to it. SQL proposals keep the main chain.
- `geminiSummaryProviders` builds that list: the summary model, then the primary. An empty setting uses the main chain.
- `LlmModule` provides the list as `LLM_SUMMARY_PROVIDERS`.
- The ask runner did not change; it already marked summary calls.
- Docs: ADR 0012, features, and `.env.example`.

## AI usage

An AI assistant (Claude Code) explained the token and latency trade-off when the user asked, then made the change the user chose and wrote the tests.

## Suggestions accepted

- **A lighter summary model** (the user chose this over "show the table first" and template-only summaries). It is faster and uses a separate rate-limit quota.

## Suggestions rejected

- **Expecting a token saving from either model choice.** Each call is stateless (`store: false`), so a second call reuses nothing, and token counts depend on the prompt, not the model. The gain is speed and quota.

## Decisions

- **The primary is the summary model's fallback**, and the template still covers any failure.
- **Routing by `purpose`** keeps the change inside the model layer: no runner, job, or test-helper changes.

## What was checked

- Unit tests: core 271 (4 new):
  - summaries go to the light model and SQL to the main chain;
  - the light model falls back to the primary;
  - with no summary list, summaries use the main chain;
  - the provider lists are built correctly from the settings.
- Other suites: API 79, worker 5, guard 310, integration 82, and end-to-end 3 pass. ESLint, Prettier, and the build pass.

## Still open

- **Showing the table before the summary arrives** (the second speed-up). It fits the frontend work if wanted.
