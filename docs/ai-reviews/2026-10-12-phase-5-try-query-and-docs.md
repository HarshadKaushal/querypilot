# AI review: try-query script and Phase 5 docs

Date: 2026-10-12
Base commit: `6e635d5` (feat(executor): run guarded SQL read-only with pools, caps, and shared limits)

## What changed

Second and last commit of Phase 5.

- `apps/api/scripts/try-query.cjs`, run with `npm run try-query --workspace=@ayd/api -- "<sql>"`. In a Nest application context it creates a temporary user, connects to the sample database as `sample_ro` over SSL, refreshes the schema, checks the SQL with the guard, runs it with the executor, prints the rows, and deletes the user (and with it the connection and snapshot).
- README, features, business domain, and implementation docs describe Phase 5. The business rule that a write is impossible at the database moved from assumed to enforced.

## AI usage

An AI assistant (Claude Code) wrote the script and the docs and ran the live checks. The developer chose a live script over an HTTP route.

## Suggestions accepted

- Run the real services, the same ones the worker will call, instead of a separate copy of the pipeline.
- Have the script compile the API itself. A `package.json` script of `npm run build && node ...` received the SQL as `^SELECT^ *^ FROM ...` on Windows. npm escapes arguments for `cmd.exe` with `^`, and a chained command never removes those escapes.
- Delete the temporary user in a `finally`, so a failure part-way still cleans up.

## Suggestions rejected

- A temporary HTTP route. The developer chose the script, and ADR 0003 keeps execution in the worker.

## Decisions

- The script reads the sample database's address from `SAMPLE_DATABASE_URL` and stops with a clear message when it is missing.

## What was checked

- Live, through npm, against the sample database. A revenue-by-customer join returned 4 rows, and Northwind's 671.00 matches the seed's payments of 455 and 216. `SELECT * FROM support.tickets` returned the three tickets without `contact_phone` or `name`, with dates such as `2025-08-06`. `SELECT email FROM customers` and `DELETE FROM orders` were stopped by the guard with their reasons.
- No `try-query` users or connections were left in the application database afterwards.
- All test suites, ESLint, Prettier, and the build pass.

## Still open

- Dependency advisories. The safe `npm audit fix` changed only `babel-plugin-istanbul` and cleared nothing. The chosen follow-up, an npm `overrides` entry forcing `deepmerge-ts` 8 under `@prisma/config`, could not be applied. npm kept 7.1.5 while the lockfile pinned it. With the lockfile entries removed, it deleted Prisma's config subtree instead of upgrading it. The dependency tree was restored from the committed lockfile with `npm ci`, and Prisma generation was checked. Nothing from that attempt is in this commit. The developer decides the next step: regenerate the whole lockfile so the override applies, accept the advisory until Prisma ships `deepmerge-ts` 8, or upgrade Prisma once it does. `sprintf-js` has no fixed version at all and is accepted, as chosen.
