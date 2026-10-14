# AI review: enforce the model call deadline (fix found during the demo rehearsal)

Date: 2026-10-14
Base commit: `1cd95c4` (docs: compare the project with the assignment brief)

## What changed

- **`GeminiProvider.generateJson`** (`packages/core/src/llm/gemini.provider.ts`) now enforces `LLM_TIMEOUT_MS` itself:
  - a deadline signal (`AbortSignal.timeout`) is joined with the job's cancel signal (`AbortSignal.any`) and passed to the SDK;
  - the call is raced against that signal, so it is no longer awaited once the deadline passes, even if the SDK keeps waiting.
- **The existing classification is unchanged:** an abort is `cancelled` only when the job's own signal was aborted, so a timeout is `unavailable`, and the client tries the fallback model.
- **Tests:** a model that never answers is cut off at the deadline as `unavailable`, and its signal is aborted; a cancelled job is still `cancelled`. The request test expects the combined signal.
- **ADR 0012:** a paragraph on enforcing deadlines in the provider.

## AI usage

An AI assistant (Claude Code) traced the user's report of a question stuck on "Writing the query" to the job record, explained the bug, and made the fix the user chose (fix now, mid-demo).

## Problems found during this change

1. **The deadline was not enforced.**
   - **Evidence:** the job's own record shows `gemini-3.8-flash:ok:113457ms`, a 113-second call against a 30-second setting. The fallback (`gemini-3.5-flash-lite`, about 1 to 2 s) never ran.
   - **Cause:** the provider relied on the SDK's `timeout` option. The only signal it passed was the job's cancel signal, so nothing in our code stopped a slow call.
   - **Why the SDK ignores its timeout** for this call is not confirmed; the fix does not depend on it.
2. **A new test had a typing error:** the mock's call arguments needed a cast through `unknown`. Fixed before running.

## What was checked

- **Model layer:** 29 tests across the provider and client, all passing.
- **The two new tests fail on the old code** (checked by stashing the fix), and pass with it.
- **After the core rebuild, the developer's worker and API restarted on their own** (they watch the built files). A preflight through the dev server then passed: connect, a SQL query, and the live stream delivering a running job's result in 55 ms.
- **Not run again:** the full suites, because the change is confined to the provider.

## Still open

- **The first live-events subscription after an API restart failed once at 16:10** and could not be reproduced. It is noted for the code review.
