# AI review: initial commit

Date: 2026-10-12
Base commit: none. This file reviews `89b478f` (Initial commit: Phase 0-2 foundation, auth, and connections), and is added by the commit that follows it.

## What changed

`89b478f` puts the existing Phase 0 to Phase 2 code and docs under git for the first time. Three changes were made just before that commit:

- `.gitattributes` with `* text=auto eol=lf`, so files keep LF endings on Windows. `infra/sample-db/entrypoint-ssl.sh` runs inside an Alpine container and fails if it gets CRLF endings.
- `apps/api/src/auth/auth.service.ts` line 105 read `DEV_LOGIN_  ENABLED`, which does not compile. The two spaces were removed.
- `CLAUDE.md` was formatted by Prettier: one trailing space removed and a final newline added. The wording did not change.

The follow-up commit adds this file and `README.md` in this folder, which sets the review format every later commit uses.

## AI usage

An AI assistant (Claude Code) read the repository, ran the checks, found the broken line and the formatting failure, and proposed the fixes and `.gitattributes`. The developer chose how each was handled. The Phase 0 to Phase 2 code itself predates this review.

## Suggestions accepted

- Fix the broken `DEV_LOGIN_ENABLED` line before committing, so the first commit compiles.
- Let Prettier format `CLAUDE.md`, so the CI format check passes.
- Add `.gitattributes`.
- Commit the existing state first, before any fix, so later fixes show up as their own diffs.

## Suggestions rejected

- Excluding `CLAUDE.md` from Prettier. The developer chose to format it.
- Rewriting `89b478f` to include this review. The developer chose to add it in the next commit and keep history unchanged.

## Decisions

- The first commit is on `main`. There was no history to protect.
- `.env`, `node_modules`, and every `dist` folder stayed out, as `.gitignore` already said. The staged list was checked for them before committing.

## What was checked

Before `89b478f`: 75 unit tests passed, the API and worker type-checked, ESLint and Prettier were clean.

## Still open

Defects found during the review are tracked in [2026-10-12-probe-and-dev-setup-fixes.md](2026-10-12-probe-and-dev-setup-fixes.md).
