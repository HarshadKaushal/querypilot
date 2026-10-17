# AI review: onboarding docs for new developers

Date: 2026-10-18
Base commit: `e891bd3` (refactor(web): one hook for running jobs, and Mantine's form in the connect wizard)

## What changed

This is commit 4 of 4 in the readability cleanup. It changes documentation only.

**New** (the user asked for each one):

- **`docs/request-flow.md`:** one question, followed through all ten steps from the button to the database and back. Each step gives the file, the function, the data in and out, and what happens on failure, plus a diagram of the four processes. It also covers the paths that reuse those steps: your own SQL, re-run, connection jobs, and cancel.
- **`docs/conventions.md`:**
  - where code lives;
  - file-name suffixes;
  - the comment style;
  - the two ways a failure travels (an `AppException` for requests, a `JobError` outcome for jobs);
  - validation and decorator order;
  - storage behind interfaces;
  - the web app's rules;
  - a "Known inconsistencies" list of what was left as it is on purpose.
- **A README in every app and package** (9 files): what it is for, where to start reading, its folders, and its commands.

**Brought up to date:**

- **`README.md`:**
  - It now opens with "How it works", "Quick start", "Where things are", and "Where to start reading".
  - "Run the web app" moved after the sections that start the API, so "either way above" is true.
  - A "Try the API by hand" heading introduces the PowerShell walkthrough.
  - Removed: Redis "queue and cache later", "A later phase adds eval", and "Those pieces are not in this phase".
- **`docs/features.md`:**
  - It no longer says "Phase 7 is next", "Query history is not stored yet", "No Swagger", or "hand-written validation".
  - The finished web app, ask pipeline, model, worker, and the other finished features moved from "Partial" to "Completed".
  - The stage list now has all eight stages.
- **`docs/implementation.md`:**
  - It says it is a log written phase by phase, and the Phase 0 parts are under a "Phase 0" heading.
  - The lines that read as current but were not (BullMQ "arrives later", introspection "runs in the API") are corrected.
  - A table maps the old web paths to the new ones.
  - The one-paragraph "How to extend this" is now checklists for tables, failures, audit, API routes, and the web app.
  - A section records this cleanup.
- **`docs/README.md`:** a "Start here" reading order for people, separate from `CONTEXT.md` (the AI session file), and `sequelize.md` listed.
- **`CLAUDE.md`:** the stack is now Vite, React, and Mantine (not Next.js) and Sequelize (not Prisma). BullMQ and the real sign-in method were added.

## AI usage

An AI assistant (Claude Code) did the following:

- found the stale and contradictory docs in a read-only audit;
- wrote the new docs;
- traced the request flow in the code before writing it (controller, queue, processor, runner, guard, executor, events, and stream);
- checked every default it quotes against `config/env.ts`: the queue name `ayd-jobs`, 5 workers, 3 jobs per user, 2 queries per connection, 15 s, 1,000 rows, and 5 MB;
- checked with a script that every file path named in the new docs exists.

## Suggestions accepted

- All four doc additions the user chose: the request-flow guide, the READMEs, the conventions guide, and the `CLAUDE.md` stack fix.

## Suggestions rejected

- **Moving the PowerShell walkthrough to its own file:** the plan said not to add another kind of file without asking. It stays in the README, under a clear heading.
- **Editing `docs/sequelize.md`'s "in progress" banner:** another session's "In progress" row still claims that file.

## Decisions

- **`implementation.md` stays a history.** It says so at the top and points to `request-flow.md` and `conventions.md` for the code as it is today, instead of rewriting every phase.

## Problems found

- The first draft of `packages/sql-guard/README.md` said coverage "must stay at 100%". The thresholds are 99/95/100/99, and functions coverage is short today (an open item). This was fixed before the commit.
- `create-sequelize.ts` was first described as "registers every model". It holds the shared settings and builds an instance for scripts and tests, and the README now says that.

## What was checked

- Prettier on every changed Markdown file.
- Every file path quoted in the new docs exists.
- The settings and limits quoted match their defaults in the code.
- Not applicable: tests and build (no code changed).

## Still open

- `docs/sequelize.md` still says the move is in progress. Update it when its session finishes.
- Generating `apps/web/src/lib/api-types.ts` from `/docs/openapi.json` would remove one hand-kept copy that new developers must remember.
