# AI review: reorganise the web app by feature

Date: 2026-10-16
Base commit: `fc89f70` (feat: document every API response in Swagger)

## What changed

The web app's `src/` moved from folders by kind (`api/`, `auth/`, `layout/`, `pages/`, `components/`) to folders by feature (ADR 0014, "Code layout"):

- `app/`: `main.tsx`, `providers.tsx`, `router.tsx`, `AppLayout.tsx`, `theme.ts`. `App.tsx` was split into `providers.tsx` and `router.tsx`, and `createQueryClient` moved to `lib/query-client.ts`. `index.html` now loads `/src/app/main.tsx`.
- `lib/`: `api-client.ts` (was `api/client.ts`), `jobs.ts`, `api-types.ts` (was `api/types.ts`), `use-abort.ts`, and the new `query-client.ts` and `query-keys.ts`.
- `components/`: only the shared `ErrorAlert` and `JobProgress`.
- `features/auth`, `account`, `connections`, `ask`, `history`, `usage`: each with an `api.ts`, its pages and tests, a `components/` folder where needed, and an `index.ts`.

Why: the user found it hard to follow a request through the app. Requests were written inline in the pages: the same connections query appeared three times, and `AskPage` imported cache keys from three other pages. Every `/v1` URL is now in a feature's `api.ts` (job routes in `lib/jobs.ts`), so a request can be traced from page, to `api.ts`, to `lib/api-client.ts`.

Smaller changes made along the way:

- `isJobError` was defined twice, in `ErrorAlert` and `FailureView`; it is now one function in `lib/jobs.ts`.
- `auth/session.ts` became `features/auth/api.ts`, with dev login, logout, and the Google start URL added beside the refresh.
- `UsageSettings.spec.tsx` became `usage/UsagePage.spec.tsx` and `account/SettingsPage.spec.tsx`.
- Local functions were renamed where they clashed with the new request functions: `SettingsPage`'s `deleteAccount` click handler became `confirmDeletion`.

## AI usage

Claude (Opus 5.5) proposed the layout, starting from a feature-folder template the user pasted and adapting it to this app. It moved the files with `git mv`, wrote the `api.ts`, `index.ts`, and `lib/` files, updated the pages, and updated the docs. The user asked for the reorganisation and supplied the template.

## Suggestions accepted

- **Feature folders with a public `index.ts`**, as in the template. This matches how the API's auth folder was grouped (`281aa4e`).
- **One `api.ts` per feature holding its requests:** reads as `use…` hooks, changes as plain functions that take the API client. The functions take the client as an argument, so they are plain and the existing `fakeApi()` tests needed no changes.
- **`app/providers.tsx` and `app/router.tsx`**, as in the template.

## Suggestions rejected

- **axios with interceptors** (template `lib/axios.ts`). `lib/api-client.ts` already adds the token, refreshes once on a 401, and turns error bodies into `ApiError`. Swapping it would be a rewrite and a new dependency.
- **Zustand stores, and Tailwind** (template `stores/`, `styles/`). Server data is in TanStack Query, and the session is in React context; Mantine does the styling.
- **A `types.ts` per feature.** The response types are copied from the server as one set (ADR 0014), and an open item may generate them from `/docs/openapi.json`. One file stays easier to keep in step.
- **Cache keys inside each feature.** Asking refreshes history and usage, and history shows ask's result views. Keys in each feature would make `ask` and `history` import each other. They are in `lib/query-keys.ts`.
- **Lazy-loading each page in the router** (template "code-splitting"). It would change loading behaviour; it is left as a follow-up for the bundle size.
- **Deeper `components/ui` and `components/feedback` folders.** There are only two shared components.

## Decisions

- History imports `QueryResultView` and `FailureView` from `features/ask`, because a re-run shows its result exactly as the ask screen does. The dependencies go one way: `connections` ← `ask` ← `history`, and every feature depends on `auth`.
- `ask/index.ts` does not export `ResultChart`. The chart stays behind its lazy `import()`, so the chart library is still a separate file that loads only for answers with a chart.
- `cancelJob` is in `lib/jobs.ts` rather than `ask/api.ts`, because `/v1/jobs/:id/cancel` is a job route like the event stream.
- The schema-read request is named `refreshSchema`, after its route and job kind, so it does not clash with `AllowlistSection`'s own `readSchema` button handler.

## What was checked

- `tsc -p tsconfig.json` and `tsc -p tsconfig.node.json` in `apps/web`: pass.
- `vitest run` in `apps/web`: 13 files, 68 tests, all pass. The count is the same as before: 68 tests in 12 files, now 13 because one file was split.
- `eslint apps/web`: no errors, and only the known warning (TanStack Virtual and the React Compiler).
- `prettier --check apps/web`: pass.
- `vite build` in `apps/web`: builds. `ResultChart` is still its own file (450 kB), and the main file is 695 kB.
- Searches: no file imports an old path, no `/v1` URL is left outside an `api.ts` or `lib/`, and no feature imports another feature's files except through its `index.ts`.
- Not run: the root `npm test`, `npm run build`, and `npm run test:browser`. A parallel session had the dev API, worker, and web servers running, and those commands rebuild the packages they run from (`docs/CONTEXT.md`). The browser tests should be run before relying on this in a demo.

## Still open

- Run `npm run test:browser` when no dev servers are in use.
- The main bundle is still about 690 kB. Lazy-loading pages in `app/router.tsx` would split it.
- The earlier steps in `docs/implementation.md` name the old paths; a note there points to the new layout.
