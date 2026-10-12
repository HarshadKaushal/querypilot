# AI review: multi-schema sample database and Phase 3 docs

Date: 2026-10-12
Base commit: `e5d3275` (feat(schema): edit the allowlist and descriptions)

## What changed

Last slice of Phase 3.

- `infra/sample-db/multi-schema.sql` adds `inventory` (warehouses, stock levels) and `support` (tickets, with a `contact_phone` column), both readable by `sample_ro`, and `finance`, which it cannot read. Compose mounts the file as the second init script. A volume created earlier can get it with the `psql` command at the top of the file, which is how the local volume was updated.
- `README.md` describes refresh, the allowed schema, and editing the allowlist, with PowerShell examples. `features.md`, `business-domain.md`, and `implementation.md` describe Phase 3 and move the allowlist rules from assumed to enforced.

## AI usage

An AI assistant (Claude Code) wrote the seed file and the doc changes, ran the checks, and ran the live walk-through below.

## Suggestions accepted

- A schema the read-only login cannot read (`finance`), so the sample shows that a refresh lists only readable objects.
- A sensitive column outside `public` (`support.tickets.contact_phone`), so the hint is visible beyond `customers.email`.
- Add the seed as a second file instead of editing `init.sql`, so an existing volume can take it without being deleted.

## Suggestions rejected

- Deleting the `sample_db_data` volume to re-seed it. The extra schemas are additive, so a `psql` run was enough and nothing was lost.

## Decisions

- Seed values stay fictional and small, like the existing retail data. Phone numbers use the reserved 555-01xx range.

## What was checked

- The seed applied to the running sample database: schemas `finance`, `inventory`, `public`, `support`.
- A throwaway container from the same image, with both init scripts and an empty volume, ran `02-multi-schema.sql` with no error and had all four schemas and the stock rows.
- Live, compiled API against the sample database over SSL: `GET /schema` before a refresh returned `SCHEMA_NOT_READY`. The first refresh returned version 1 with 8 tables and 35 columns. The allowed schema listed `inventory`, `public`, and `support` tables, with `customers.email` and `tickets.contact_phone` hidden and flagged sensitive. `finance` never appeared. A PUT allowing only `orders` with a description returned it with the foreign key dropped, because `customer_id` was not allowed. A PUT against version 1 after a second refresh returned `SCHEMA_CHANGED`. The check account was deleted afterwards.
- Unit 157, integration 28, end-to-end 3, ESLint, Prettier, and the full build all pass.

## Phase 3 acceptance

Against `docs/blueprint.md`:

- **Only allowlisted objects appear in any schema output.** `allowedSchema` is the only builder. Covered by `allowed-schema.spec.ts`, including keys, by the HTTP tests, and by the end-to-end refresh test.
- **Refresh creates a new version.** Covered by the HTTP tests and the end-to-end test, including two concurrent refreshes.
- **Tests with a multi-schema sample database pass.** `schema-introspection.int-spec.ts` and `schema-refresh.int-spec.ts` run on multi-schema scratch databases. The live run used the multi-schema sample.
- **Refresh with cache invalidation.** No cache exists until the LLM phase. Every refresh and allowlist edit changes the fingerprint the cache will key on (ADR 0008).

## Still open

- Introspection runs in the API until the executor moves to the worker.
- When a connection's host is an IP address, it is passed as the TLS server name, which Node warns about. Recorded in [2026-10-12-probe-and-dev-setup-fixes.md](2026-10-12-probe-and-dev-setup-fixes.md) and not yet fixed.
