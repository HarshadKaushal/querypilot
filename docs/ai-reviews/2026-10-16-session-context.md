# AI review: a shared session context file

Date: 2026-10-16
Base commit: `9fc040a` (fix: enforce the model call deadline in the Gemini provider)

## What changed

Docs only. No code changed.

- **`docs/CONTEXT.md` (new, at the user's request):** the starting point for every session, including parallel ones. It covers:
  - how to keep it current, and rules for parallel sessions;
  - a status snapshot and the project in brief;
  - a repository map, how to run the project locally, and test commands with their last results;
  - the user's workflow rules, the decisions the user has made, and pitfalls that cost time;
  - open items, an "In progress" claim table, and a session log.
- **`CLAUDE.md`:** a new section 17, "Shared Session Context". Claude reads the file first, claims tasks in it, and updates it after every commit and before a session ends. The old section 17, "Final Principle", is now 18.
- **`docs/README.md`:** `CONTEXT.md` added to the index, first.

## AI usage

An AI assistant (Claude Code) wrote both from the repository and the 2026-10-14 work, after checking `git status` and the commit log.

## Decisions

- **The file links to the ADRs, implementation notes, and review files** instead of copying them, so it stays short and is cheap to keep current.
- **Parallel-session rules** come from problems seen on 2026-10-14:
  - builds restart other sessions' dev servers;
  - orphaned processes stayed running;
  - commits could mix one session's files with another's.

## What was checked

- **The snapshot matches the repository:** a clean tree at `9fc040a`, and the commit list.
- **Test counts are from the last runs recorded in the review files.** Core gained 2 provider tests after its last full run, and the file says so.
- **Prettier passes.** No tests were run, because no code changed.

## Still open

- **Each session has to keep the file current;** the `CLAUDE.md` rule asks for it.
