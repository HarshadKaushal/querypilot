# Session context

The shared starting point for every Claude session on this repository, including several running at once. **Read this first, then update it** (see "Keeping this file current"). The code is the source of truth; this file says where things stand and what was decided, so a new session does not have to rediscover it.

Last updated: 2026-10-16, after stage 2a, request validation (base `9713c2a`).

## Keeping this file current

- **Read it at the start** of every session, before planning or editing.
- **Claim work before starting it.** Add a row to "In progress" (what, which files, date), so a parallel session does not take the same task. Remove the row when the work is committed or dropped.
- **Update it before ending a session or after each commit:** the snapshot line, "Status", "Open items", "Decisions" (anything the user chose), "Pitfalls" (anything that cost time), and one line in "Session log".
- **Keep it short.** Detail belongs in the ADRs, `docs/implementation.md`, and the AI review files; link to them instead of copying.
- **Parallel sessions:**
  - Do not run `npm run build`, `npm test`, `test:int`, or `test:browser` while another session is using the dev servers. Building rewrites the packages' `dist` folders, and the running API and worker restart.
  - Commit one session at a time. Check `git status` first, and never commit another session's unfinished files.
  - Do not stop processes another session started. Check a process's start time and command line before stopping it.

## Snapshot

- **Phases 0 to 9 of the blueprint are done.** Phases 10 (observability and hardening), 11 (evaluation and load tests), and 12 (deployment) are not started.
- **Against the assignment brief,** two items are open, the evaluation dataset with results and deployment instructions. Two more are nearly done: Swagger docs (only response schemas left) and DTO validation (request bodies done). See "Open items".
- **All work is committed locally on `main`;** nothing is pushed. The user reviews commits afterwards.

## The project in brief

"Ask Your Database" (the user also calls it QueryPilot): a user signs in with Google, connects their own PostgreSQL database read-only, chooses which tables and columns the AI may see, and asks questions in English.

- **Gemini** writes SQL.
- **The SQL guard** (PostgreSQL's own parser) checks it.
- **A worker** runs it read-only.
- **The answer** is a table, a chart chosen by fixed rules, the SQL, and a summary whose numbers are checked.
- **History** keeps no result rows.

**Stack:** npm workspaces monorepo, Node 24, TypeScript 6.

| Area           | Tools                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| API and worker | NestJS 12 (ESM-only, loaded from CommonJS via `module: node20`)                                             |
| Data           | Prisma 7, Postgres 18, Redis 8                                                                              |
| Jobs           | BullMQ 6                                                                                                    |
| Model          | `@google/genai` (Interactions API); models `gemini-3.8-flash`, fallback and summary `gemini-3.5-flash-lite` |
| Web            | React 19, Vite 8, Mantine 9, TanStack Query, React Router 8                                                 |
| Tests          | Jest (backend), Vitest (web), Playwright with axe (browser)                                                 |

## Repository map

| Path                  | What                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api`            | HTTP API: auth, validation, ownership, limits, app-database work, queues jobs, streams progress (SSE)           |
| `apps/worker`         | Takes jobs from Redis. The only process that opens customer databases or calls the model                        |
| `apps/web`            | React app (sign-in, connect wizard, ask, history, usage, settings)                                              |
| `packages/core`       | Shared Nest modules: connections, schema, executor, jobs, ask pipeline (`src/ask/`), LLM layer, limits, history |
| `packages/sql-guard`  | SQL guard (`guard.ts`, rules in `analyzer.ts`)                                                                  |
| `packages/ssrf-guard` | Host and address checks                                                                                         |
| `packages/crypto`     | Envelope encryption of credentials                                                                              |
| `packages/database`   | Prisma schema and migrations                                                                                    |
| `packages/shared`     | Error codes and envelope, request id                                                                            |
| `e2e/`                | Playwright browser tests (own API on 3100, web on 5174, queue `ayd-e2e`)                                        |
| `docs/`               | Blueprint, ADRs 0001 to 0014, features, implementation, testing, `extra.md`, AI reviews                         |

Imports starting `@ayd/` are these packages. They are linked through `node_modules`, and run from each package's built `dist`.

## Running it locally

```powershell
npm run up:deps      # Docker: app-db :5434, sample-db :5433, redis :6379
npm run dev          # API on :3000 (reads root .env at start only)
npm run dev:worker   # worker
npm run dev:web      # web app on :5173 (proxies /v1 to :3000)
```

- **Sample database** (the "customer" data): `localhost:5433`, db `sample`. Logins: `sample_ro` / `sample_ro_password` (read-only, what the platform uses) and `sample_admin` / `sample_admin` (owner). In the app, use host **`127.0.0.1`** and port **`5433`**. The form defaults to 5432, which fails.
- **App database:** `localhost:5434`, db `ayd`, user `ayd` / `ayd`.
- **Data range:** the sample data is July to October 2025, so relative dates like "last quarter" return nothing.
- **Google sign-in** is configured in `.env` (keys saved 2026-10-14). Dev login also works in development.
- **Gemini key** is set in `.env`. Answers take about 8 to 17 s; the provider enforces a 30 s deadline, then falls back.
- **Test-only setting:** `LLM_FAKE=true` makes the worker use a scripted model. The browser tests set it, and production refuses it.

## Tests and checks

| Command                                                 | What                                            | Last result                                                                                           |
| ------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm test`                                              | Unit tests, no Docker                           | API 110, web 68, worker 6, core 291 (+2 provider tests since), guard 310, ssrf 25, crypto 4, shared 4 |
| `npm run test:int`                                      | Real Postgres and Redis                         | 95                                                                                                    |
| `npm run test:e2e`                                      | API end to end                                  | 3                                                                                                     |
| `npm run test:browser`                                  | Playwright demo flow and axe, desktop and phone | 6                                                                                                     |
| `npm run test:browser:live`                             | One real-Gemini question (opt-in)               | 1                                                                                                     |
| `npm run lint`, `npm run format:check`, `npm run build` |                                                 | pass (one known lint warning: TanStack Virtual and the React Compiler)                                |

`test:int`, `test:browser`, and `build` rebuild packages: see the parallel-session rules above.

## Workflow rules (the user's)

- **Read `CLAUDE.md`.** The user is learning full-stack development: explain beginner-style, explain the plan and the affected files before implementing, and keep changes small.
- **Bugs:** explain the cause and suggest fixes; **the user decides** what to do.
- **Commits:**
  - Commit locally only, and never push.
  - Bundle small fixes together; amend a commit if the user has not reviewed it yet.
  - End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **One AI review file per commit** in `docs/ai-reviews/YYYY-MM-DD-<subject>.md`, with sections: What changed, AI usage, Suggestions accepted, Suggestions rejected, Decisions, Problems found, What was checked, Still open.
- **Keep docs in step with every change:** README, `docs/features.md`, `docs/implementation.md`, `docs/testing.md`, the relevant ADRs, and this file.
- **Never read out secrets** from `.env`. Report only whether a key is set, and its length.

## Decisions the user made

- **SQL route:** keep the raw-SQL route, guarded.
- **Model and summaries:**
  - Rows go to the model only if the connection allows it.
  - Labels are stripped everywhere when rows are not allowed.
  - Summaries use a lighter model.
- **Limits:**
  - 50 questions a day, 10 submissions a minute.
  - History re-run replays the stored SQL (no model call).
  - The sign-in rate limit fails open when Redis is down.
- **Audit:** history and connection deletions are audited in the same transaction as the delete.
- **Frontend:** Vite and Mantine (not Next.js, although `CLAUDE.md` mentions it). The Google callback redirects to the web app.
- **Browser tests:**
  - A scripted model, plus one or two live Gemini questions.
  - Local only for now; a CI job later.
- **Development setup:** the dev API stays listening on all interfaces (with dev login on); the user chose not to change it.
- **Docs:** `docs/extra.md` lists what the project does beyond the brief.
- **API docs (Swagger), in two stages:**
  - Stage 1 (done 2026-10-16): `/docs` with tags, summaries, status codes, and example bodies.
  - Stage 2, together with class-validator (brief item 4): DTO classes that both document and validate. 2a (request bodies) is done; 2b (response schemas) is next.
  - The docs are not served in production.
- **Request validation (2026-10-16):**
  - A failure gives a specific message, still with code `VALIDATION_ERROR`.
  - Undeclared fields are dropped silently, not rejected.
  - Stricter types are accepted: a wrong type is a 400 now, where it used to be ignored.

## Pitfalls (things that cost time)

- **Building or testing restarts dev servers:** they run from `dist`. A job in flight then loses its live stream; the web app reconnects after 45 s of silence.
- **On Windows, stopping `npm` leaves child processes running** and holding ports. Find them with `Get-CimInstance Win32_Process`, check the start time and command line, then stop them by id.
- **Shell escaping:** backticks, `$`, and `\n` inside heredocs or `node -e` get mangled. Write scripts to the scratchpad with the Write tool, or use the Edit tool.
- **Integration tests hang if Docker Desktop has stopped.** Check `docker ps` first.
- **After moving or renaming source files, the old build output stays in `dist`.** `tsc` never deletes files. Remove the stale ones, or code might load an outdated copy.
- **When testing by hand, use throwaway dev-login users and delete them afterwards** (`DELETE /v1/users/me`).
- **Decorators run from the bottom up.** In a DTO, put the basic type check (`@IsString`, `@IsArray`) closest to the property, or a wrong type gets the wrong message (for example "too long" for a number).
- **A first question may be "answered from a saved query"** if it was asked before: the cache key is connection, schema fingerprint, and normalised question.

## Open items

**Against the brief** (estimates from 2026-10-14):

1. Evaluation dataset and report, about 3 to 4 h.
2. Swagger docs: stages 1 and 2a are done. Left is **2b**, response schemas: documentation-only classes for what each route returns, about 1 to 1.5 h.
3. Deployment instructions, about 2 to 3 h; a real cloud deployment is Phase 12.
4. DTO validation with class-validator: done for every request body (stage 2a, `docs/ai-reviews/2026-10-16-request-validation.md`). The history `limit` and `cursor` query is still clamped by hand, on purpose.

**Planned:**

- A code review of the 2026-10-14 work (8b, Phase 9, and the fixes), about 1 h.
- Phase 10: tracing, metrics, dashboards, alerts, CORS, CSRF, security headers, a guard review, and a dependency audit.

**Loose ends:**

- **One API unit test failed once** (1 of 94, 2026-10-16, right after the package builds), then passed 3 runs in a row. It is not known which test. If it fails again, save the full Jest output.
- **The first live-events subscription after an API restart hung once** (2026-10-14 16:10). It could not be reproduced. Check `JobEvents.subscribe` and `streamJob` in the code review.
- **Not built yet:** a chart-type switcher, example question-and-SQL pairs in the prompt, a circuit breaker per model provider, a key re-wrap job, readiness checks for the queue and the model, data export, partitions and retention, a rate limit on connection tests, browser tests in CI, and editing a connection's login in the app.
- **The main web bundle is about 680 kB** before compression.

## In progress

| What   | Files | Session started |
| ------ | ----- | --------------- |
| (none) |       |                 |

## Session log

- **2026-10-14:**
  - Phase 8b: limits, usage, and audit.
  - Phase 9: web app (9a to 9d), browser tests, and accessibility.
  - Fixes: the silent-stream reconnect, and the model deadline.
  - The brief comparison and `docs/extra.md`.
  - A demo rehearsal with Google sign-in and DBeaver.
- **2026-10-16:**
  - This context file added, with a `CLAUDE.md` rule to keep it current.
  - `apps/api/src/auth/` grouped into `protect-routes/`, `sign-in/`, `tokens/`, and `storage/`, behind an `index.ts` (no logic change; see `docs/ai-reviews/2026-10-16-auth-folder-layout.md`).
  - Swagger stage 1: `@nestjs/swagger` 12.0.2, Swagger UI at `/docs` outside production, all 32 routes documented, and `openapi.spec.ts`.
  - Stage 2a: 9 request DTO classes, a global `ValidationPipe`, and `validation.spec.ts`. `test:int` (95), `test:e2e` (3), and `test:browser` (6) passed, which also covers the earlier two commits, and a live check against the dev API passed.
