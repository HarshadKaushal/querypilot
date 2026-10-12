# AI review: record accepted dependency advisories

Date: 2026-10-12
Base commit: `327f010` (feat(api): add a try-query script and document Phase 5)

## What changed

`docs/dependency-advisories.md` records the two `npm audit` advisories left in place, `deepmerge-ts` (via the Prisma CLI) and `sprintf-js` (via Jest's coverage tooling): why each is safe here, the fixes tried, and when to revisit. The docs index links it. No code or dependency changed.

## AI usage

An AI assistant (Claude Code) traced both advisories to their callers, tried the fixes, explained the risk, and wrote the note. The developer decided to accept both, because no user request reaches either package.

## Suggestions accepted

- Write the decision down with a revisit trigger, so a later `npm audit` run is not mistaken for new findings.

## Suggestions rejected

- Regenerating the whole lockfile to force `deepmerge-ts` 8. It could move dozens of unrelated package versions to clear a dev-only advisory.
- `npm audit fix --force`, which downgrades Prisma and ts-jest.

## Decisions

- Revisit both before a release, and whenever Prisma or Jest is upgraded.

## What was checked

- `npm ls` confirmed both packages are reached only through the Prisma CLI's config loader and Jest's coverage loader.
- Prettier passes on the new files.

## Still open

None.
