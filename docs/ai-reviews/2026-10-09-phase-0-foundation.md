# AI review: Phase 0 foundation

Date: 2026-10-09
Scope: initial foundation, before the first git commit
Related work: monorepo, Compose stack, health, error envelope, documentation

This file is the AI-assisted review for the Phase 0 change set. Later commits each get their own file in this folder. The file name should include the date and a short commit subject. This one has no commit hash yet because the work was not committed.

## What was reviewed

- Phase boundary. The blueprint says not to start Phase 1 until Phase 0 acceptance passes. Auth, Gemini, SQL validation, and the UI are absent on purpose.
- Failure behavior. Unhandled errors return `INTERNAL_ERROR` and a fixed sentence. A unit test checks that a connection string in a thrown error does not appear in the JSON body.
- Health behavior. A thrown driver error becomes `down` plus latency. The body has no message field.
- Logging. pino redacts common secret paths. `safeErrorDetail` removes `postgres://` and `redis://` URLs before a dependency failure is logged. This is not a complete secret scanner.
- Configuration. Zod failures report field names only. The test uses a URL-shaped value and asserts the thrown text does not have to contain the password because the password is never interpolated.
- Sample database. The seed includes email addresses and a read-only role. Those are fixtures. The API does not open that database.
- Images. The runtime image includes the full workspace install so `prisma migrate deploy` can run. That is wider than a production image should be.

## Decisions

- Prisma over TypeORM, recorded in the implementation notes, because migrations are plain SQL in git and the client is enough for `SELECT 1`.
- No domain tables in the baseline migration. Adding `users` now would start the auth phase's schema without its acceptance tests.
- Health stays off the error envelope. Probes need a stable check object, including when the status is 503.
- JSON logs in every environment. A pretty printer would fork the format the blueprint asks for.
- Google OIDC plus a local dev login, and Gemini as the first model provider, are written down in the README and feature list and not coded.

## Reflections

The duplicated env parsers are the first drift risk. If the worker gains `DATABASE_URL` later, the two Zod schemas can disagree. Move them when the third setting is shared, not before.

Readiness does not check the sample database. That is correct: the sample database is a stand-in for a customer, not a platform dependency. A down sample database must not take the API out of service.

CI never boots Compose. A green workflow can still hide a broken Dockerfile. The manual acceptance command remains `npm run up` and `GET /health/ready`. A later phase can add a Compose smoke step if the images keep breaking.

## Follow-ups before Phase 1

- Verified on 2026-10-09: `docker compose up --build -d` reached `"status": "ok"` on `/health/ready`, the worker logged `worker ready`, and the sample database contained 5 customers. An unknown route returned `NOT_FOUND` and echoed `x-request-id: demo-req-01`.
- The application database is published on host port 5434. Port 5432 was already taken by another local Postgres, and stopping that container was out of scope.
- Keep secrets in `.env` or the host environment. Do not add Gemini or Google credentials to Compose.
- On the first commit, add the commit hash to the title of the next review file and leave this file as the pre-commit review of the foundation.
