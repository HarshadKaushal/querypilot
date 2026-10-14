# AI review: browser tests, a scripted model, and the accessibility pass (Phase 9 complete)

Date: 2026-10-14
Base commit: `cb22f13` (feat: add the history, usage, and settings pages)

## What changed

- **Scripted model (worker), ADR 0012:**
  - `LLM_FAKE=true` puts `ScriptedLlmProvider` (`packages/core/src/llm/scripted.provider.ts`) in both model chains.
  - It answers by fixed rules: "region" → SQL counting orders per region; "how many orders" → a count; "best" → ambiguous; "delete"/"drop" → `DELETE FROM public.orders` for the guard to refuse; anything else → unanswerable. Its summary has no numbers, so the server's number check keeps it.
  - `checkCoreEnv` refuses `LLM_FAKE` in production.
- **Browser tests, `e2e/` (Playwright 1.64, axe 4.13):**
  - `settings.ts` starts their own API (port 3100) and web dev server (port 5174), with high limits and their own job queue (`ayd-e2e`). `global-setup.ts` starts their own worker and waits for "worker ready".
  - **Demo flow (`demo.spec.ts`):** sign in with the form; connect through the wizard; ask (summary, chart, table); an ambiguous question; an unsafe request refused by the guard; unsafe SQL; then history, usage (3 of 50), and deleting the account in Settings.
  - **Accessibility (`a11y.spec.ts`):** axe on the sign-in page and every signed-in page (ask with an answer, connections, a connection, the wizard, history, usage, settings). Serious and critical problems fail.
  - **Screen sizes:** every test runs at 1280×800 and on a Pixel 7.
  - **Live check (`live.spec.ts`):** one real-model question, run on purpose (`npm run test:browser:live`).
  - **Scripts:** `test:browser` and `test:browser:live` at the root; their output folders are ignored by git and Prettier.
- **Web app:**
  - `src/theme.ts` fixes the contrast problems the checks found: primary blue 8, dimmed gray 7, and darker text on light badges, buttons, and alerts, all in light mode.
  - SQL code blocks are focusable and named.
  - The Vite proxy target reads `AYD_API_URL`, and `vite.config.ts` is type-checked with Node types in `tsconfig.node.json`.
- **Docs:** testing, ADR 0005, ADR 0012, ADR 0014, implementation, features, the README, and `.env.example`.

## AI usage

An AI assistant (Claude Code) proposed the approach, wrote the scripted model, the tests, and the fixes, and ran the suites. It asked the user how answers should be produced and whether to add a CI job.

## Suggestions accepted

- **The user's choice:** a scripted model for the browser tests, plus one or two real-model questions in a separate run. Browser tests run locally for now; a CI job comes later.
- **Separate ports and a separate job queue for the tests**, so a developer's running real-model worker cannot take a test job, and the tests cannot disturb the developer's servers.
- **Fixing contrast once, in the theme**, rather than on each page.

## Suggestions rejected

- **Mocking the question requests in the browser.** Offered; it would not test asking end to end.
- **Real Gemini for every browser test.** Offered; it would break the testing rule, cost quota, and make results vary.

## Decisions

- **The scripted model's unsafe answer is a real DELETE**, so the test proves the guard refuses it. It does not rely on a model declining.
- **The tests run one at a time.** They share the sample database's two query slots per connection.
- **The live run is not part of `test:all`.**

## Problems found during this change

1. **The accessibility checks found real problems:**
   - white on Mantine's default blue is about 3.6:1;
   - dimmed text is about 3.3:1;
   - light badges were too faint;
   - the setup-SQL box scrolled but could not take keyboard focus.

   All were fixed, and the checks now pass at both sizes.

2. **Test mistakes, fixed before commit:**
   - `getByLabel('Name')` also matched "Username" (Playwright matches substrings), so the labels became exact;
   - the accessibility test waited for a heading that is a plain card title on the connections page. That made the demo look flaky in the full run, until the real failure was read.
3. **Building for the tests restarts dev servers you have running** (the earlier spinner issue). This is now in the README and testing docs.

## What was checked

- **Browser suite:** 6 of 6 tests, twice in a row (about 40 s each): the demo flow and both accessibility tests, at desktop and phone sizes.
- **Live browser test:** 1 of 1. Real Gemini answered through the page with a summary and the SQL, and no error.
- **Unit suites:** API 94, web 68, worker 6 (1 new: `LLM_FAKE` is refused in production), core 291 (3 new: scripted rules, prompt parsing, chain switch), guard 310, ssrf 25, crypto 4, shared 4.
- **API end-to-end:** run again, because the core settings changed.
- **Other checks:**
  - ESLint (the one known warning) and Prettier pass;
  - after the runs, ports 3100 and 5174 were free and no test worker remained.
- **Not run again:** integration tests. No database behaviour changed.

## Still open

- **A CI job for the browser tests** (the user chose later).
- **The main bundle is about 680 kB before compression.**
- **axe catches about a third of accessibility problems.** A manual pass with a screen reader is still worth doing before release.
