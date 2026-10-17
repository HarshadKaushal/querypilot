# @ayd/sql-guard

Decides whether SQL is one safe read over the tables and columns a user allowed, and rewrites it before it runs (ADR 0009). It uses PostgreSQL's own parser (`libpg-query`), so it sees the query exactly as the database would. It never connects to a database.

**What it accepts:** one `SELECT`, optionally with non-recursive `WITH` queries, over allowed tables and columns, using approved functions, casts, and operators. Everything else is refused with a `code` and a `reason`, for example writes, DDL, system catalogs, hidden columns, or a second statement.

**What it returns:** schema-qualified tables, alias-qualified columns, `*` expanded to the allowed columns, and the top-level `LIMIT` capped at the row cap plus one. The extra row tells the executor that the result was cut. The output is parsed and checked a second time.

**Start reading at**

- `src/guard.ts`: `checkSql()`, the entry point, and the second check of its own output.
- `src/analyzer.ts`: the rules. It walks the parse tree and refuses any node type it does not know (default deny).
- `src/allowlists.ts`: the approved functions, types, and operators.
- `src/__fixtures__/`: the attack and safe queries the tests run.

**Commands:** `npm run test:unit -w @ayd/sql-guard`. This runs with coverage, and the thresholds are 99% statements, 95% branches, 100% functions, and 99% lines, because this is safety code. Functions coverage is at 98.8% today, so the command fails on that threshold although every test passes. That is an open item in `docs/CONTEXT.md`.
