# AI review: read-only probe and local dev setup fixes

Date: 2026-10-12
Base commit: `7c3339f` (docs: add AI review template and review the initial commit)

This commit bundles seven fixes found while reading the code and running it on the host. They were first made as five separate commits and squashed into one at the developer's request, because small commits made the important ones hard to find.

## What changed

Read-only probe (`apps/api/src/executor/user-database.probe.ts`), the check that keeps write-capable logins out:

1. **Inherited and PUBLIC grants.** The write check read `information_schema.role_table_grants` for the login alone. That view leaves out PUBLIC grants, and grants to a group role appear under the group's name. The probe now asks PostgreSQL directly with `has_table_privilege` and `has_any_column_privilege`, and ownership uses `pg_has_role`.
2. **Roles reachable with `SET ROLE`.** SUPERUSER, CREATEDB, and CREATEROLE are never inherited, so a member of a superuser role passed and could then become one. Every check now covers each role where `pg_has_role(current_user, role, 'MEMBER')` is true, including `NOINHERIT` memberships.
3. **CREATE on the database.** A login with it passed, then could create a schema and tables. It is now refused with its own message.
4. **Setup SQL on PostgreSQL 14 and earlier.** Those versions grant CREATE on `public` to PUBLIC, which the probe rightly refuses, but the setup SQL from `GET /v1/meta/egress` never said how to remove it. It now ends with `REVOKE CREATE ON SCHEMA public FROM PUBLIC;` after a comment, and the probe names that command when it is the cause.
5. **Error messages.** Failures were called SSL problems whenever the driver text contained "ssl", and a `pg_hba.conf` rejection says "SSL encryption". `connect-error.ts` now decides from the SQLSTATE, Node's socket and TLS codes, and the pg driver's fixed sentences.

Connections and local setup:

6. **Status after a rename.** `update` set `status: 'active'` even when the probe did not run, so renaming a failing connection marked it healthy. Status and `lastTestedAt` now change only when the probe runs.
7. **`.env` and `npm run dev`.** The API and worker looked for `.env` in `apps/`, one level too shallow, so a process on the host never read it. And `npm run dev` used tsx, whose esbuild compiler drops the decorator metadata Nest needs, so the API crashed at startup. Both env loaders now use the root path, exported and tested. `npm run dev` now runs `apps/api/scripts/dev.cjs`, which compiles with `tsc --watch` and restarts with `node --watch`. tsx is removed from the API's dev dependencies.

## AI usage

An AI assistant (Claude Code) found all seven problems, explained each one, and proposed the fixes. The developer chose to fix all of them. The assistant wrote the code, the tests, and the docs, and ran the checks.

## Suggestions accepted

- Ask PostgreSQL's privilege functions instead of reading grant views, because the functions apply inheritance and PUBLIC the way the server does.
- Use `MEMBER`, not `USAGE`, so roles reachable only through `SET ROLE` count, and apply that role set to all five checks.
- Separate messages for a membership problem and for CREATE on the database, so the user is pointed at the right grant.
- Classify connection errors by code in a separate, table-tested module.
- Prove the privilege rules on a throwaway database (`apps/api/test/helpers/scratch-database.ts`), and run those tests against the code before each fix to show they fail there.
- Compile dev with the same `tsc` setup as the production build, using a 30-line script instead of a new dependency.
- Export the `.env` path and test it, so a change in folder depth fails a test instead of failing silently.

## Suggestions rejected

- New error codes for each connection failure. The messages are specific now, and keeping the codes avoids changing the client contract.
- Leaving the REVOKE line commented out. A PostgreSQL 14 user who copies the SQL as given would still be refused.
- Rejecting every login that belongs to any role. Group roles that hold only SELECT are a normal way to manage grants.
- Rejecting the TEMPORARY privilege. PUBLIC has it on every database by default, so nearly every login would be refused.
- Adding `@Inject(...)` to every constructor so tsx works. The next service written without it would break dev again while every test still passed.
- Loading `.env` from `process.cwd()`. The result would depend on the folder a command starts in.

## Decisions

- The write check joins `pg_roles` to `pg_class`, so its cost grows with roles times tables. A dedicated read-only login usually belongs to one or two roles, and a superuser login is refused by the first query.
- The probe integration tests use the application Postgres with SSL turned off in the client factory, so they run in CI, which has no TLS-enabled server. The SSL path was checked by hand against the sample database.

## What was checked

- Unit tests: 66 in the API, including a table-driven error classifier and a test that every privilege query is scoped to `MEMBER` roles.
- Integration tests: 13 probe cases on a throwaway database: a SELECT-only login; INSERT through a group role, through PUBLIC, and on one column; a member of a table's owning role; CREATE on `public` through PUBLIC; CREATE on another schema; CREATE on the database; a member of a superuser role; a `NOINHERIT` member of a writer role; a wrong password; and an unknown database. Before each fix, its new cases failed on the code without it.
- Live, over SSL, against the sample database: `sample_ro` was accepted, `sample_admin` refused, and a wrong password, a server without TLS, and a closed port each got their own message.
- The compiled worker started with no environment variables set, reading only `.env`. `npm run dev` started the API, sign-in returned 200, and saving a source file restarted it.

## Still open

- When a connection's host is an IP address, it is passed as the TLS server name, which Node warns about.
- A failed address lookup during a connection test is not recorded.
