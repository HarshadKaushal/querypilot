# AI review: Swagger API docs, stage 1

Date: 2026-10-16
Base commit: `281aa4e` (refactor: group the API's auth folder by job behind an index file)

## What changed

- **Dependency:** `@nestjs/swagger` `~12.0.2` in `apps/api`. Its peers `class-validator` and `class-transformer` are optional, so they were not installed.
- **`apps/api/src/common/openapi.ts` (new):**
  - `buildOpenApiDocument(app)` builds the OpenAPI 3 document from the registered routes. It adds:
    - a description that explains how to sign in from the page;
    - the `bearer` (access token) and `cookie` (refresh cookie) security schemes;
    - an `ErrorEnvelope` schema that matches what `AllExceptionsFilter` writes.
  - `setupApiDocs(app, env)` serves Swagger UI at `/docs`, and the document at `/docs/openapi.json` and `/docs/openapi.yaml`. It returns `false` and serves nothing when `NODE_ENV` is `production`.
  - `ApiErrors(400 | 401 | 404 | 429, ...)` documents the usual failures with that envelope, so controllers do not repeat the text.
- **`main.ts`:** calls `setupApiDocs`, and logs the docs URL when they are served.
- **All 10 controllers (32 routes):**
  - `@ApiTags` on each controller, plus `@ApiBearerAuth()` and `@ApiErrors(401)` on the protected ones;
  - `@ApiOperation` with a summary on every route, and a description where the behaviour is not obvious;
  - `@ApiResponse` for each success status;
  - `@ApiBody` with a hand-written schema and an example for every body;
  - `@ApiQuery` for optional query parameters;
  - `@ApiCookieAuth()` on refresh and logout;
  - `@ApiProduces('text/event-stream')` on the job events stream.
- **`apps/api/src/common/openapi.spec.ts` (new, 6 tests):**
  - every route Nest registers appears in the docs, each with a summary and a tag;
  - protected routes need the bearer token, and the public ones (auth, health, meta) do not;
  - failures point at `ErrorEnvelope`;
  - the question route shows an example body;
  - `/docs` and `/docs/openapi.json` are served outside production, and both answer 404 in production.
- **Docs:** README ("API docs (Swagger)"), `docs/features.md` (API surface), `docs/implementation.md` (how it works, and what a new controller needs), `docs/testing.md`, and `docs/CONTEXT.md`.

## AI usage

An AI assistant (Claude Code) did the following:

- inspected the controllers and checked the package's support for NestJS 12 and its peer dependencies;
- offered three scopes, and the user chose two stages;
- wrote the code, the test, and the docs.

## Suggestions accepted

- **Two stages:** documentation now, then DTO classes together with class-validator, so no class is written twice.
- **No docs in production.**
- **The test finds controllers from `AppModule`'s metadata** instead of a hand-kept list, so a new controller is checked automatically.

## Suggestions rejected

- **Doc-only DTO classes now:** they would be rewritten when validation is added.
- **`persistAuthorization` in Swagger UI:** it would keep the access token in the browser's localStorage. Re-entering a 15-minute token is acceptable for a development page.

## Decisions

- **The docs are not served when `NODE_ENV` is `production`.** They list every route and input, which helps an attacker. A protected docs page can come with deployment if one is wanted.
- **Response bodies are only described in words.** Their schemas come with the DTO classes in stage 2.
- **`openapi.ts` imports `REFRESH_COOKIE` from `auth/sign-in/cookies`, not from `auth/index.ts`.** Going through the index would create a circular import: the index loads `AuthController`, which imports `openapi.ts`. The file is app wiring, like the test helpers.

## Problems found

- **The first connection example used `sslMode: 'disable'`, which the API refuses (`SSL_REQUIRED`).** Reading `ConnectionService` caught this. The example now uses `require`, and the field lists only `require` and `verify-full`.
- **A first draft said a table listed without `columns` allows none of them.** The code shows only that listed columns are stored, so the description says only that.
- **A first test expected 33 routes; there are 32.** The test now counts the routes Nest registers instead of using a fixed number.
- **The test was checked against a real failure:** with one summary removed, it failed and named `DELETE /v1/history`.

## What was checked

- **Build:** `npm run build -w @ayd/api` passes.
- **API unit tests:** `npm run test:unit -w @ayd/api` passes 100 of 100 (94 before, plus 6 new).
- **Lint:** `npm run lint` passes, with only the known TanStack Virtual warning.
- **Formatting:** `npm run format:check` passes.
- **Audit:** `npm audit` lists only the advisories already accepted in `docs/dependency-advisories.md`. Nothing new came in with `@nestjs/swagger` (its `js-yaml` is 5.4.2).
- **The real `AppModule` compiles** with `@nestjs/testing`.
- **A docs-only preview served Swagger UI.** It was built from the same controllers with empty services. The document had 32 operations in 10 tags and both security schemes.
- **Not run:**
  - The real API with Docker (Docker Desktop was off), so "Try it out" against real services is untested.
  - `test:int` and `test:e2e`.

## Still open

- **Stage 2, with class-validator (brief item 4):** DTO classes with `@ApiProperty` and validation rules, replacing the hand-written `@ApiBody` schemas, plus response schemas.
- **Try `/docs` against the running API** the next time Docker is up: dev login, Authorize, then a question.
