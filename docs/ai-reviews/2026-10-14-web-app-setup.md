# AI review: the web app, sign-in, and the connections list (Phase 9 step 9a)

Date: 2026-10-14
Base commit: `c833c01` (feat: add rate limits, the daily question quota, usage, and audit)

## What changed

**New workspace `apps/web` (ADR 0014).**

- **Stack:** React 19.3, Vite 8.3, Mantine 9.7, TanStack Query 5.104, React Router 8.4. Tests: Vitest 5, Testing Library, jsdom.
- **`src/api/client.ts`:** the only code that calls the API.
  - Adds `Authorization: Bearer`.
  - Turns the error envelope into an `ApiError` (code, message, request id, `Retry-After`).
  - Gives a network failure the code `NETWORK_ERROR`.
  - On a 401, refreshes once and repeats the request. Never for `/v1/auth/*`.
- **`src/auth/`:**
  - `AuthProvider` keeps the access token in memory only and restores the session on load from the refresh cookie.
  - `session.ts` allows one refresh at a time: one shared promise in a tab, Web Locks across tabs.
  - `RequireAuth` sends signed-out users to `/sign-in`.
- **Pages:**
  - `SignInPage`: the Google button, an explanation for `?error=` codes, and the dev login in development builds only.
  - `AppLayout`: header, menu (a drawer on phones), sign out.
  - `ConnectionsPage`: cards with status and last check, delete with confirmation, an empty state, and an error with the request id.
- **Dev server:** Vite on port 5173 passes `/v1` to the API on port 3000.

**API: Google sign-in answers the browser with redirects.**

- `GET /v1/auth/google/callback`: sets the refresh cookie, then redirects to `APP_WEB_ORIGIN`. A known failure (`AppException`) redirects to `/sign-in?error=<code>`.
- `GET /v1/auth/google/start`: when Google is not configured, redirects to `/sign-in?error=AUTH_NOT_CONFIGURED` instead of answering with 503 JSON.
- Unexpected errors on both routes still reach the error filter.

**Repo wiring:**

- `apps/web` added to the root `build` chain and a new `dev:web` script.
- Both Dockerfiles copy `apps/web/package.json`, which `npm ci` needs.
- ESLint applies `eslint-plugin-react-hooks` (7.1) to `apps/web`.

**Docs:** ADR 0014 (new), the README ("Run the web app", Google sign-in, layout, status line), implementation (Phase 9 section, module format), features, and testing.

## AI usage

An AI assistant (Claude Code) mapped the API contracts and the repo tooling, proposed the plan and the three choices, and wrote the code, tests, and docs.

## Suggestions accepted

- **The user's choices:** Mantine; Google callback redirects to the app; Phase 9 in four steps with one commit each.
- **Vite, as the blueprint fixes**, rather than the Next.js the project's `CLAUDE.md` mentions as a possible technology.
- **One origin through a proxy** rather than CORS, so the httpOnly cookie works and nothing cross-origin needs configuring yet.
- **The access token in memory**, not localStorage.

## Suggestions rejected

- **`EventSource` for job progress** (for step 9c). It cannot send the `Authorization` header, and the API deliberately refuses a token in the URL. Progress will use fetch with a stream reader.
- **Importing response types from `@ayd/core`.** Core is Node-only and would pull server code into the browser bundle. The types are copied instead (ADR 0014).
- **Tailwind or shadcn/ui, and MUI.** Offered; the user chose Mantine.
- **Upgrading TypeScript to 7 with the web app.** TypeScript 7 is a major upgrade for the whole repo, so it belongs in its own change. The web app uses the repo's TypeScript 6.

## Decisions

- **Two refreshes must never run at once.** The API treats a refresh token used twice as stolen and revokes the sign-in. React runs start-up effects twice in development, so without the shared promise every page load in development would have signed the user out. A test renders the provider in StrictMode and checks there is exactly one refresh.
- **The token lives in a small `TokenHolder` object, created once with `useState`**, rather than a `useRef`. The React hooks lint rule flagged the ref, because reading a ref while rendering can show stale values. Here the token is only read when a request is sent, so the flag was a false alarm, but the holder makes that obvious without a lint exception.
- **The Google start route was changed as well as the callback.** It had the same problem (raw JSON in the browser when Google is not configured), so it follows the same rule. This goes slightly beyond the callback change the user approved.
- **Signing out clears TanStack Query's cache**, so nothing one user loaded can show for the next.
- **Retries:** queries retry network failures and 5xx answers up to twice, never 4xx.

## Problems found during this change

1. **The Google callback answered with JSON.** A browser arriving from Google would have shown raw JSON. Fixed with the user's approval; the start route had the same issue.
2. **A concurrent refresh would revoke the session** (see Decisions). Found by reading `AuthService.refresh` before writing the client.
3. **A test failed because both test connections had the same address**, so a lookup found two matches. The test data was wrong, not the page.
4. **A type error in a test** (`vi.fn()` without the `fetch` type) and **the hooks lint rule on the ref.** Both fixed before commit.
5. **Stopping the dev servers through npm on Windows left their child processes running** and holding ports 3000 and 5173. They were stopped by process id after checking their command lines.

## What was checked

- **Web unit tests (Vitest): 17, all new.**
  - **API client:** the token is sent; one refresh and a retry on 401; giving up when the refresh fails; no refresh for auth routes; the error envelope and `Retry-After` of a 429; network and non-JSON errors; the status from `send`, and 204.
  - **AuthProvider:** exactly one refresh on load in StrictMode; signed out with no cookie; signed out, not stuck loading, when the server cannot be reached.
  - **Sign-in page:** the Google link; the `?error=` explanation; dev login, with an error and its request id.
  - **Connections page:** the list with status; the empty state; the error with the request id; delete after confirming, then the list reloads.
- **API tests:** 94 (3 new or changed: the callback sets the cookie, redirects to the app, and the cookie then refreshes; a failed callback redirects to the sign-in page with no session; an unconfigured start redirects to the sign-in page).
  - A first run alongside the Docker build had 3 suites time out after about 30 minutes each. Rerun alone, all 94 passed in 46 seconds.
- **Manual check through the Vite dev server** (port 5173, real API and database):
  - the page loads; dev login sets the cookie on `/v1/auth`; refresh with the cookie gives 200;
  - `/v1/connections` gives 200 with the token and 401 without it;
  - Google start redirects to `/sign-in?error=AUTH_NOT_CONFIGURED`; a deep link (`/connections`) is served the app;
  - logout gives 204, and refresh after logout gives 401.
- **Other checks:**
  - core 288, worker 5, guard 310, ssrf 25, crypto 4, shared 4, integration 95, and end-to-end 3 pass;
  - ESLint (with the hooks rules), Prettier, and the full build (including `vite build`) pass;
  - both Docker images build, including `npm ci` with the new workspace;
  - `npm audit` shows only the three advisories already accepted in `docs/dependency-advisories.md`; the new packages added none.

## Still open

- **The response types are copied** from the server and can drift. Moving them into `@ayd/shared` is a later clean-up.
- **No CORS or CSRF configuration** on the API. That's safe while page and API share one origin; it is Phase 10 work before they are ever split.
- **A 429 from the sign-in rate limit on the Google callback is still JSON**, because the guard runs before the handler. Rare.
- **Web Locks are missing in very old browsers.** There, only the in-tab protection applies, and two tabs refreshing at the same instant could sign the user out.
- **The JavaScript bundle is 484 kB (147 kB compressed).** Splitting pages into separate files can come with the later steps.
- **Playwright browser tests** (the demo flow) and the accessibility pass are later in Phase 9.
- **The project's `CLAUDE.md` names Next.js** while the blueprint and this code use Vite. The user may want to update it.
