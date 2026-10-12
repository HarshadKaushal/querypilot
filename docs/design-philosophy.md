# Design Philosophy

Ask Your Database is a pass-through. A customer question is translated into a checked, read-only query against that customer's database. The product stores accounts, encrypted connection settings, a filtered picture of the schema, and query metadata. It does not store result rows, and it does not keep a copy of the business data.

## Phase gates

The blueprint is a sequence of phases with acceptance checks. A later phase does not start because it is tempting to scaffold it. Phase 0 exists so every later safety control has a place to log, fail, and be tested the same way.

## Small modules, one way out

User-database access will have a single executor. Credential decryption will have a single crypto module. SQL safety will be a pure function in its own package, with no network. Phase 0 follows the same idea at a smaller scale: HTTP failures leave through one exception filter, and configuration leaves through one parser.

## The API stays stateless

Nothing about a user sits in process memory. Health checks do not create a session. Rate limits, locks, and job state will live in Redis when they exist. The worker is a separate process so a slow database cannot occupy the API.

## Safety is layered, and wording is not a control

When SQL generation arrives, the model is untrusted. Schema names and cell values are untrusted. Rejection will come from a parser, a read-only transaction, a read-only role, timeouts, and caps. Phase 0 already applies a smaller version of that rule to its own errors: clients receive a code and a fixed or explicit message, and logs do not receive passwords or connection URLs.

## Prove the narrow thing

Safety libraries will be written test-first. This phase tests the parts that can be wrong without a database: request-id acceptance, the error envelope, environment parsing, and the health report when a dependency throws. The Compose stack is the check that wiring is real.

## Leave room without pretending it is built

PostgreSQL-only, one egress IP, and a swappable model provider are architectural constraints, not extra features to implement now. Interfaces show up when the first real caller exists. An empty adapter with no tests would only look finished.

## Operability is part of the feature

A request has an id. A log line is JSON. Readiness fails when Postgres or Redis fails, and the body says which check failed without quoting the driver. Those habits are cheaper to start in the foundation than to retrofit after the ask pipeline exists.
