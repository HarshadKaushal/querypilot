# AI review: the connect wizard and the allowlist editor (Phase 9 step 9b)

Date: 2026-10-14
Base commit: `42267a3` (feat: add the web app with sign-in and the connections list)

## What changed

All changes are in `apps/web` and the docs. The API is unchanged.

- **Following jobs, `src/api/jobs.ts`:**
  - `JobEventParser` reads the API's Server-Sent Events: `event: job` blocks, keep-alive comments, events split across chunks, and CRLF.
  - `watchJob` follows a job to its end: it reconnects up to three times, then polls `GET /v1/jobs/:id`. It stops on a 4xx or when aborted.
  - `runJob` starts a job and follows it.
- **`src/api/use-abort.ts`:** `useUnmountSignal` stops a followed job when the page is left.
- **Connect wizard, `/connections/new`:**
  1. The egress address, the firewall advice, and the setup SQL with a copy button.
  2. The login form, checked in the browser against the API's limits, then `connection.create` and `schema.refresh` with live progress.
  3. The allowlist. If the schema read fails, the connection is already saved, and this step offers "Read schema" instead of saving twice. The password is cleared from the page once saved.
- **Connection page, `/connections/:id`:** status, a connection test (a job), the sample-rows switch (`PATCH`, 200), and the allowlist section.
- **`AllowlistSection` and `AllowlistEditor`:**
  - read or re-read the schema, and summarise the result (defaults applied, or how many new objects start hidden);
  - a tick per table and per column, a "sensitive" badge, and optional descriptions (500 characters at most);
  - a filter for more than 8 tables;
  - saving sends the full list with the version it was edited against;
  - `409 SCHEMA_CHANGED` offers a reload;
  - a ticked table with no ticked column cannot be saved.
- **Changed pieces:**
  - `ErrorAlert` also shows a failed job's message and code;
  - the connections list has "Connect a database" and "Open";
  - `fakeApi()` takes loosely typed overrides;
  - `job()` and `eventStream()` test helpers.
- **Docs:** ADR 0014 (following jobs), implementation (step 9b), features, testing, and the README (worker needed, sample database values).

## AI usage

An AI assistant (Claude Code) planned the step, checked the API's job, schema, and allowlist contracts in the code, and wrote the code, tests, and docs.

## Suggestions accepted

- **Two jobs in a row in the wizard**: create, then read the schema. The create job does not read the schema (checked in `connection-job.runner.ts`).
- **The full allowlist list with its version on save**, as the API expects. A concurrent schema read is caught as `SCHEMA_CHANGED`, not silently overwritten.

## Suggestions rejected

- **`EventSource`.** It cannot send the token (see ADR 0014).
- **`@mantine/form`.** A plain `useState` form with one `validateConnection` function is less to learn and is tested on its own.
- **Starting the schema read from an effect** when the wizard's last step opens. The read runs in the submit handler instead, so React's double effects in development cannot start it twice.

## Decisions

- **Browser checks mirror the API's limits** (label 80, host 253, database 63, username 128, password 256, port 1 to 65535), so mistakes show beside the field. The API still checks everything.
- **A ticked table needs at least one ticked column.** The app enforces this; whether the API would accept such a table was not checked.
- **Editing a saved connection's address or login is not in the app.** The API supports it (a `connection.update` job). It is not one of the blueprint's screens, and can join the settings step if wanted.
- **The user chose to leave the development API listening on all network interfaces** (with dev login on), after this was explained in step 9a. Production refuses dev login.

## Problems found during this change

1. **TypeScript rejected four test mocks**: a mock returning a fixed type cannot stand in for the generic `get<T>()`. Fixed once, in `fakeApi()`.
2. **A doc sentence was off by one.** The ADR first said `watchJob` polls "after three failed attempts". The code makes the first attempt plus three reconnects. Corrected before commit.
3. **An `npm run test:int` process started at 09:44 is still running** on this machine. It may be left from an earlier run stopped this morning, but that is not confirmed, so it was left for the user to decide.

## What was checked

- **Web unit tests:** 39 (22 new).
  - **Event parser:** split chunks, keep-alive, CRLF, other events, broken JSON.
  - **`watchJob`:** follows to the end; returns at once for a finished job; reconnects after an early end; polls after repeated failures; stops on 404 and on abort.
  - **Allowlist editor:** starting state and the sensitive badge; the saved body (only ticked items, trimmed descriptions, the version); the empty-table guard; reload on `SCHEMA_CHANGED`.
  - **Wizard:** egress and SQL shown; field checks before any request; the full path (create, read, allowlist); the worker refusing the login (`NOT_READ_ONLY`), with the form kept; a refused request (`TOO_MANY_JOBS`).
  - **Connection page:** schema not read yet (read, then a failure shown); the sample-rows `PATCH`; a failed test with its code; a 404.
- **Manual check through the Vite dev server**, with the real API, worker, and sample database:
  - egress 200; dev login;
  - create 202, then live events "running (checking_access)" at 0.39 s and "succeeded" at 0.98 s, which shows the proxy passes events through as they happen;
  - schema read: 8 tables and 35 columns, defaults applied, `customers.email` and `tickets.contact_phone` hidden as sensitive;
  - allowlist saved (200); a save with an old version gives 409 `SCHEMA_CHANGED`;
  - connection test succeeded; sample rows on (200);
  - the test connection and the throwaway test user were deleted afterwards.
- **Other checks:**
  - `tsc`, `vite build`, ESLint, and Prettier pass;
  - the other workspaces are unchanged since step 9a, where every suite passed, and were not run again.

## Still open

- **Editing a connection's address or login in the app** (see Decisions).
- **The allowlist editor renders every table at once.** Fine for the schema limit the API enforces; a very wide schema may want a virtualised list.
- **Carried over from step 9a:** copied response types, no CORS or CSRF configuration (one origin for now), Playwright tests, the accessibility pass, and bundle splitting.
