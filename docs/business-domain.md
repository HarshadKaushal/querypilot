# Business and Domain Understanding

Notes for Ask Your Database. Items marked **enforced** are true in the current code. Items marked **assumed** come from the blueprint and are not implemented yet.

## What the product is

A person signs in, connects a PostgreSQL database they already operate, and asks a business question in everyday language. The system proposes SQL, runs it only if it is a safe read, and shows a table, a chart, the SQL, and a short explanation.

The company does not become a second system of record. **Assumed:** business rows stay in the customer's database. The application database holds accounts, connection settings, schema allowlists, and query history without result rows.

## Who the user is

**Enforced:** a Google subject id is the account key. The local development login uses a synthetic subject `dev:<email>` and is not available when `NODE_ENV` is `production`. There are no teams or shared connections. Profile reads and account deletion use the user id inside the access token.

**Enforced:** every connection row is owned by that user. A lookup, test, update, or delete for an id the user does not own is `404`.

**Assumed:** history rows will follow the same ownership rule.

## What they may connect

**Enforced:** PostgreSQL only, over SSL (`require` or `verify-full`). Each of the following rules applies to the login and to every role it belongs to, whether it inherits that role or can switch to it with `SET ROLE`. None of those roles may be a superuser or able to create databases or roles. None may hold INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER on any table, or INSERT, UPDATE, or REFERENCES on any column, including grants to PUBLIC. None may own a table or view outside the system catalogs, have CREATE on a non-system schema, or have CREATE on the database. When that CREATE comes from PUBLIC on the `public` schema, the default on PostgreSQL 14 and earlier, the message says to run `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, and the egress setup SQL includes that line. Link-local, unspecified, and cloud-metadata addresses are rejected. Loopback and private addresses are rejected unless `SSRF_ALLOW_PRIVATE` is set, and that flag cannot be set when `NODE_ENV` is `production`.

**Enforced:** `GET /v1/meta/egress` returns the platform egress IP from `EGRESS_IP` and SQL that creates a SELECT-only role. A real fixed egress IP is still a deployment task. The local value is the documentation address `192.0.2.10`.

**Enforced in the sample:** `infra/sample-db/init.sql` creates `sample_ro` with `SELECT` on the public tables. `multi-schema.sql` adds `inventory` and `support`, which it can read, and `finance`, which it cannot. `sample_admin` exists so the container can create the database. The connection flow should reject `sample_admin` and accept `sample_ro`. From the host the host is `127.0.0.1` and the port is `5433`. From the API container the host is `sample-db` and the port is `5432`. The name `localhost` is allowed only while private addresses are allowed.

## What the model is allowed to see

**Enforced:** a schema snapshot holds only what the login can SELECT: names, types, nullability, and keys. It never holds rows or PostgreSQL comments. A user chooses which tables and columns are allowed and can describe them. On a connection's first snapshot, columns that look like emails, phone numbers, addresses, national IDs, dates of birth, card or bank numbers, or credentials start hidden, and everything else starts allowed. A table or column found by a later refresh starts hidden. Pointing a connection at another host, port, or database deletes its snapshots and allowlist, so choices made for one database are never applied to another. Every schema output for the model comes from one function that applies the allowlist, to primary and foreign keys as well. On the sample, `customers.email` and `support.tickets.contact_phone` start hidden.

**Assumed:** the platform owns the Gemini API key. Users do not bring a model key. SQL generation sees the allowlisted schema, not the whole catalog. The summary sees the question, column names, a capped sample of rows, and computed statistics. Schema names, descriptions, and cell values are untrusted.

**Assumed:** if the question is ambiguous or cannot be answered from the allowlist, nothing is executed. The user gets a clarification or an explanation.

## How an answer is judged

**Assumed:** a successful answer shows the rows (up to a cap), a chart chosen from column types and cardinality, the SQL, the assumptions, and a summary that only uses numbers present in the supplied data. Truncation is visible. History stores status, latency, model, and token counts, and can run the question again. It does not store the rows.

**Enforced:** SQL that is not a single read over allowed tables and columns is rejected by the SQL guard, with a code and a reason. That covers writes, DDL, hidden columns, system catalogs, and functions off the approved list. The guard never runs anything, and no result can exceed the row cap (1,000 by default). A result with exactly the cap is reported complete; only one with more is marked cut.

**Enforced:** a write is also impossible at the database. The login is checked to be read-only when it connects and on every schema refresh. Every query runs in a READ ONLY transaction that is rolled back, as a single statement, with a statement timeout. A result never exceeds the row cap or 5 MB, and a cut result is marked as truncated.

## Rules the foundation already follows

**Enforced:**

- Application configuration fails closed when `DATABASE_URL` or `REDIS_URL` is missing or not the right scheme.
- Clients never receive raw exception text.
- Logs are not a place for passwords, tokens, or connection URLs. Request bodies redact `password` and `username`.
- Stored connection secrets are ciphertext. Audit metadata records the connection id and `ok` or `failed`, not the password.
- The sample business data is a separate database from the application database.
- A missing or invalid access token is `UNAUTHENTICATED`. Refresh tokens are stored as hashes. Reuse of an old refresh token revokes that login family.
- Account deletion removes the user. The audit row records the event without keeping the email.

## Sample business the seed describes

The seed is a fictional wholesale and retail book of five customers, five products, eight orders, line items, and payments. Cancelled order 6 has no payment. Order 8 is still open and unpaid. Regions are North, East, West, and South. Money is `numeric` dollars. Dates are in 2024 and 2025. These facts are fixtures for later evaluation questions, not a live customer.

Example questions the later evaluation set can use against this seed:

- revenue from fulfilled orders
- top customers by paid amount
- stationery versus grocery sales
- orders with no payment

Ambiguous, unanswerable, and unsafe questions will be added with the evaluation phase. They are not classified by code today.

## Privacy

**Enforced:** account deletion removes connections through the foreign key and writes an audit entry. Schema snapshots and allowlist rows go with their connection.

**Assumed:** account deletion will also remove query history. A data export will exist. History is not stored yet.
