# Implementation Documentation

Phase 0 of Ask Your Database. The product blueprint is the source of the phase list. This note records how the foundation was built and why.

## Approach

The repository is an npm workspace monorepo. The API and the worker are separate NestJS processes that share only published workspace packages. Phase 0 puts the error envelope and request-id rules in `@ayd/shared` so later HTTP handlers do not invent a second error shape.

Work stayed inside the Phase 0 acceptance line:

- one command starts the local stack
- CI runs lint, format check, unit tests, and build
- readiness reports the application database and Redis

Domain modules (auth, connections, SQL guard, executor, ask pipeline, history, UI) were not started.

## Technical decisions

| Topic                  | Choice                             | Why                                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager        | npm workspaces                     | Node 22+ and npm 11 are already installed. No second package manager.                                                                                                                                                           |
| API framework          | NestJS 11                          | Locked by the blueprint. The API process is stateless.                                                                                                                                                                          |
| Worker                 | Nest application context           | Same framework, separate entry point. It only checks Redis in this phase.                                                                                                                                                       |
| App database access    | Prisma 6                           | Migration history is in git. The schema has no domain models yet.                                                                                                                                                               |
| Baseline migration     | `SELECT 1`                         | Creates migration history without tables that belong to later phases. The next phase adds its own migration.                                                                                                                    |
| Cache and queue broker | Redis 7 via ioredis                | Present now so health can report it. BullMQ arrives with the queue phase.                                                                                                                                                       |
| Config                 | Zod parse of the environment       | Invalid fields are named. Values are not printed, so a bad URL is not logged.                                                                                                                                                   |
| Logs                   | pino JSON                          | `message`, level, and `service` on every line. Authorization, cookie, password, secret, and token paths are redacted. Database URLs are stripped from error text before it is logged.                                           |
| Request id             | `x-request-id`                     | Accepted when it matches a short safe pattern. Otherwise generated. pino stores it as the request id and writes it on the response.                                                                                             |
| Errors                 | Stable envelope                    | `error.code`, `error.message`, `error.requestId`. Unhandled exceptions become `INTERNAL_ERROR` with a fixed sentence. Raw driver or framework text is not returned.                                                             |
| Health                 | `/health/live` and `/health/ready` | Live means the process is up. Ready pings Postgres and Redis. Failure is HTTP 503 with `status: degraded` and no driver message.                                                                                                |
| Sample database        | Second Postgres on port 5433       | Seeded retail tables and a `SELECT`-only role. It is not a dependency of API readiness.                                                                                                                                         |
| Images                 | Multi-stage Dockerfiles            | Build in Node 22 Alpine, run `prisma migrate deploy` then the API. The image currently copies the workspace install, including dev dependencies, so the Prisma CLI is present. A slim runtime image is a deployment-phase task. |
| CI                     | GitHub Actions                     | Lint, Prettier, unit tests, and compile. It does not start Docker.                                                                                                                                                              |

## Milestones

1. Workspace, TypeScript, ESLint, and Prettier.
2. Shared error and request-id contract, with unit tests.
3. API config, JSON logging, exception filter, Prisma, Redis, and health.
4. Worker process that refuses to start when Redis is unreachable.
5. Compose stack: application Postgres, sample Postgres, Redis, API, worker.
6. CI workflow and the documentation set in `docs/`.

## Challenges

- Prisma's empty schema still requires `DATABASE_URL` at generate time. The generate script fills a local default when `.env` is absent, and the API image sets the variable for the build stage. Runtime still uses the real URL.
- Readiness must prove the dependencies without becoming a way to leak connection errors. Checks log a name and a URL-stripped message, and the HTTP body only says `up` or `down`.
- The worker and the API both need a validated Redis URL. The parsers are duplicated on purpose so the worker does not import the API. They should move to a shared config package when a third caller appears.
- Host ports are 5434 for the application database, 5433 for the sample database, and 6379 for Redis. 5432 is left free because many local Postgres installs already use it. Inside Compose, the API still reaches the application database at `app-db:5432`.

## Trade-offs

- Unit tests mock Postgres and Redis. CI does not prove the Compose health path. The local acceptance check is `npm run up` and `GET /health/ready`.
- The worker logs through pino directly. Nest's own logger is disabled there so boot lines stay JSON. The API uses `nestjs-pino`, which also covers request logs.
- Pretty logs are not the default. JSON is harder to scan on a laptop and is the format the blueprint requires.
- Domain tables are absent. That keeps this phase from deciding column details the auth phase should own. The cost is an empty application database until the next migration.
- Local database passwords live in Compose and in the sample seed. They are development defaults, not a secrets-manager design. Envelope encryption and a real secrets manager are later phases.

## Phase 1: authentication and users

Google sign-in uses authorization-code flow with PKCE. The code verifier sits in a short-lived encrypted httpOnly cookie, so the API process does not keep a session. The callback verifies the Google ID token with Google's published certificates and rejects an unverified email.

The access token is an HS256 JWT lasting 15 minutes by default. It is returned in JSON. The refresh token is a random secret, stored only as a SHA-256 hash, and sent back in the `ayd_refresh` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production). Rotation updates the row only if it is still unused. A second use of an old token revokes every token in that family.

`POST /v1/auth/dev/login` exists for this laptop. `loadEnv` refuses to boot when that flag is true and `NODE_ENV` is `production`. The Compose file therefore runs the API as `development`, which also lets the cookie be stored over `http://localhost`.

Account deletion writes `account.deleted` and then deletes the user. Refresh tokens cascade. The audit row's user id is set to null, and the metadata keeps the deleted id. Connections cascade with the user. History is not a table yet.

Login is not rate limited yet. That belongs with the quota phase. CSRF tokens for cookie calls belong with the hardening phase. `SameSite=Lax` is the control in place now.

Access tokens are signed in-process. The `jose` package is used only to verify Google ID tokens, because that check needs Google's JWKS. Tests do not load that package.

## Phase 2: connections, encryption, and SSRF

Connection passwords are sealed before they touch Prisma. `@ayd/crypto` generates a data key, encrypts the username and the password separately with AES-256-GCM, and wraps the data key with the master key named by `CRYPTO_MASTER_KEY_VERSION`. A later rotation calls `rewrapCredentials`, which unwraps the data key and wraps that same key again. The password ciphertext stays put. Parser failures say `invalid master key ring` and do not include the key bytes.

`@ayd/ssrf-guard` decides from a hostname plus the addresses DNS returned. The API resolves the name, and the probe connects to the pinned address, not the name, so a later DNS answer cannot swap in a private host. `servername` stays the original host so `verify-full` can check the certificate. The pinned address is not stored. Every test resolves again.

`SSRF_ALLOW_PRIVATE` exists so this laptop can reach the sample database at `127.0.0.1` or the Compose hostname `sample-db`. Production boot refuses the flag. Cloud metadata addresses, `0.0.0.0`, and link-local ranges stay blocked even when the flag is on.

The sample image generates a self-signed certificate and turns SSL on. Clients use `sslMode: require` against it. `verify-full` is for a server with a certificate that matches the hostname.

The read-only probe is the start of the executor. Create and credential changes call it before saving. A failed retest sets `status` to `failing`, writes `connection.tested`, and returns `CONNECTION_FAILED`, `SSL_REQUIRED`, or `NOT_READ_ONLY`. The response text is written in the probe. Postgres error text is logged through `safeErrorDetail` and is not returned.

`GET /v1/meta/egress` is public. Compose sets `EGRESS_IP` to the documentation address `192.0.2.10` until a real NAT gateway exists.

## How to extend this

Add a phase only after this phase's checks pass: `npm test`, `npm run lint`, `npm run format:check`, and a ready health response from `npm run up`. New application tables go in a new Prisma migration. New client-visible failures go through `AppException` and an existing or newly documented error code in `@ayd/shared`.
