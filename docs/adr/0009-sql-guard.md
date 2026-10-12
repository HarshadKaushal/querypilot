# ADR 0009: SQL guard

`@ayd/sql-guard` decides whether SQL is one safe read over allowlisted tables and columns. It is a pure function: SQL and the schema snapshot's tables in, a verdict and the SQL to run out. It never opens a network connection or a database.

**Parser.** SQL is parsed by PostgreSQL's own parser, `libpg-query` (libpg_query compiled to WebAssembly), on the PostgreSQL 17 grammar, pinned to an exact version. A guard that reads SQL differently from the server can be fooled through the difference, so a regular-expression or hand-written parser is not used.

**Default deny.** The guard walks the parse tree and accepts only node types and fields it knows. Anything else, including a field a future parser version adds, is rejected. Functions, cast types, and operators come from fixed lists in `allowlists.ts`. One plain SELECT, optionally with non-recursive WITH queries, is the only statement accepted.

**Rewrite.** The guard returns SQL rewritten so PostgreSQL cannot read it any other way than the guard did. Every table gets its schema, and a table name without a schema means `public`. Every column reference gets the alias it was resolved to. `SELECT *` and `alias.*` over a table become the list of allowed columns, while `*` over a subquery or WITH query is rejected. The top-level LIMIT is added, or lowered to the row cap (1,000 by default, `SQL_ROW_CAP`), and `limitApplied` reports when that happened.

**Name resolution.** The guard is given every table in the snapshot with every readable column, hidden ones included. It resolves an unqualified column the way PostgreSQL does, innermost query level first, so a hidden column in an inner query cannot be mistaken for an allowed column of the same name further out. A reference that would be rewritten to an alias an inner level reuses is rejected as ambiguous. Whole-row references, system columns, and unknown names are rejected.

**Deparser check.** Turning the rewritten tree back into SQL uses `pgsql-deparser`, which is not PostgreSQL's code. Its output is parsed again by the real parser and checked again, and has to come back unchanged. If a deparser bug changed the meaning, the second check sees the changed query, and the guard returns `verification_failed` rather than the SQL.

**What the executor must do (Phase 5).** The guard is one layer. The executor runs its output in a READ ONLY transaction with a statement timeout and a row cap of its own. It also sets `search_path` to empty, so the unqualified function, type, and operator names the guard approved resolve in `pg_catalog` and never to an object of the same name in a user schema.

**Not accepted in v1:** recursive queries, LATERAL, `JOIN ... USING`, NATURAL JOIN, functions in FROM, VALUES lists, parameters, arrays, row constructors, COLLATE, and `FETCH ... WITH TIES`. Each is rejected with a reason the model can act on, such as "Write ON a.column = b.column instead". Any of them can be added later with its own corpus cases.
