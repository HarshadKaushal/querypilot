# AI review: SQL guard package

Date: 2026-10-12
Base commit: `7428fc6` (fix: record failed host lookups, send no IP as the TLS server name)

## What changed

Phase 4: `packages/sql-guard`, built test-first. `checkSql(sql, { tables, rowCap })` returns either `{ ok: true, sql, limitApplied }` with the SQL to run, or `{ ok: false, code, reason }`. ADR 0009 records the design.

- `guard.ts` parses with PostgreSQL's parser (`libpg-query@17.7.4`), requires exactly one SELECT, runs the analyzer, caps the top-level LIMIT, deparses (`pgsql-deparser@17.18.5`), then parses and checks that output again and requires it to come back unchanged.
- `analyzer.ts` walks the tree with default deny. It resolves tables and columns against the snapshot (hidden columns included, so resolution matches PostgreSQL's), rejects anything outside the allowlist, and rewrites names to be fully qualified. `SELECT *` over a table becomes the allowed columns.
- `allowlists.ts` holds the approved functions (aggregates, window, date, text, and number functions), cast types, and operators.
- 16 rejection codes, each with a reason written for both a person and the model, for example "Write ON a.column = b.column instead."

## AI usage

An AI assistant (Claude Code) designed and wrote the package, the attack and safe corpora, the tests, and ADR 0009. The developer chose PostgreSQL's own parser, a 1,000-row cap, the strict function list, expanding `SELECT *` to allowed columns, and a check endpoint (next commit). The assistant settled the rest and recorded it in the ADR.

## Suggestions accepted

- PostgreSQL's real parser on a pinned PostgreSQL 17 grammar, instead of a JavaScript approximation of the grammar.
- Default deny on node types and fields, so a future grammar feature is rejected until someone adds it on purpose.
- Pass every snapshot table with hidden columns marked, and resolve unqualified names innermost-first like PostgreSQL. The corpus covers a hidden `support.tickets.name` inside a subquery under an allowed outer `customers.name`, which a guard that only knew allowed columns would let through.
- Rewrite the output to fully qualified names, so later schema changes cannot redirect a reference.
- Re-parse and re-check the deparser's output, because the deparser is not PostgreSQL's code. A test with a faulty deparser shows a hidden column put back by it is caught.
- A coverage minimum in the package's Jest config (99% of statements, 95% of branches), because the blueprint asks for near-complete coverage of the rules.

## Suggestions rejected

- `libpg-query` 18. Released within the last month. The 17 line has been out since July and reads SELECT the same way PostgreSQL 12 to 18 does.
- Expanding `*` over subqueries and WITH queries. Their output names would come from the guard's approximation of PostgreSQL's naming rules. Rejecting is safer, and the model can list the columns.
- Supporting `JOIN ... USING`, LATERAL, and recursive queries now. Each needs extra scoping rules, and each has a simple rewrite the model can be told to use.
- Leaving names unqualified in the output. PostgreSQL would then resolve them again on its own, possibly against a column added after the snapshot.

## Decisions

- A table name without a schema means `public`, PostgreSQL's default `search_path`. The output always names the schema.
- An inner query that reuses an outer alias is fine, as in `WHERE id > (SELECT avg(id) FROM orders)`. Only a reference that would be rewritten to a name an inner level shadows is rejected.
- ORDER BY and GROUP BY treat a bare name as an output column only when that output's name is certain (an explicit alias or a plain column). Otherwise the name is checked as an input column, which can only reject more, never allow more.
- SQL longer than 20,000 characters, or nested deeper than 100 levels, is refused before or during the walk.
- The executor must use an empty `search_path` and a READ ONLY transaction. This is written in ADR 0009 for Phase 5.

## What was checked

- 309 tests in the package. 181 attack lines, each expecting its rejection code. 82 safe queries, each passing, with the output passing again unchanged. Exact-output tests for qualification, `*` expansion, outer references, output aliases, WITH queries, and comment removal. Row-cap tests for no LIMIT, a smaller one, zero, the cap itself, a larger one, `LIMIT ALL`, `FETCH FIRST`, UNION, and subqueries. Reason, input-size, and dependency tests. Hand-built trees for defensive branches the grammar does not reach. A mocked faulty deparser.
- Coverage: 99.8% of statements, 97.2% of branches, all functions. The uncovered branches are defensive checks the PostgreSQL 17 grammar cannot reach.
- The first run found two of my own mistakes, both fixed. An empty string makes libpg_query throw instead of returning no statements, so blank input is now checked first. And an operator-name check ran before the schema-qualified-operator check, which made the latter unreachable.
- ESLint, Prettier, and the full unit run of every workspace pass.

## Still open

- Nothing calls the guard yet. The next commit adds the check endpoint, and the executor and model phases will call it too.
- `npm audit` reports 20 moderate advisories in existing dev tooling (Jest, js-yaml, Prisma CLI), none in the new packages. Not changed here.
