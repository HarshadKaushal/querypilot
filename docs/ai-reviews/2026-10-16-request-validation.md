# AI review: request validation with DTO classes (stage 2a)

Date: 2026-10-16
Base commit: `9713c2a` (feat: serve Swagger API docs at /docs outside production)

## What changed

- **Dependencies:** `class-validator` 0.15 and `class-transformer` 0.5 in `apps/api`.
- **`apps/api/src/common/validation.ts` (new):** `createValidationPipe()` returns a `ValidationPipe` with these settings:
  - `whitelist`: undeclared fields are dropped;
  - `transform`: the controller gets the DTO instance;
  - `stopAtFirstError`;
  - an `exceptionFactory` that throws the API's own `invalidRequest()` with the first message.

  `firstValidationMessage()` adds the path for nested fields, such as `tables.0.columns.0.name must be a string`. `main.ts` and `testing/http-app.ts` both install the pipe.

- **DTO classes, beside their controllers:** each field carries `@ApiProperty` for the docs and class-validator rules for the check.
  - `auth/sign-in/dev-login.dto.ts`: `DevLoginDto`
  - `connections/connection.dto.ts`: `CreateConnectionDto`, and `UpdateConnectionDto` built from it with `PartialType`
  - `jobs/jobs.dto.ts`: `RunSqlDto` and `AskQuestionDto` (`MAX_QUESTION_LENGTH` moved here)
  - `sql-guard/check-sql.dto.ts`: `CheckSqlDto`
  - `schema/allowlist.dto.ts`: `UpdateAllowlistDto`, with the nested table and column DTOs
- **Controllers:** every body is now typed with its DTO. The following were removed:
  - the `typeof` checks;
  - `readCreate` and `readPatch`;
  - the `ConnectionBody` and `DevLoginBody` interfaces;
  - every hand-written `@ApiBody` schema.

  Dev login keeps `@ApiBody({ type: DevLoginDto, required: false })`, because it may be called with no body.

- **Tests:**
  - `common/validation.spec.ts` (new, 9 tests): messages, dropped fields, trimming, SQL kept as written, nested paths, stricter types, and a missing dev-login body.
  - `openapi.spec.ts`: a test that every request body is a DTO `$ref`, and one for the question DTO's example and limit, replacing the stage 1 example test.
- **Docs:** README (API docs), `docs/features.md`, `docs/implementation.md`, `docs/testing.md`, and `docs/CONTEXT.md`.

## AI usage

An AI assistant (Claude Code) did the following:

- explained DTOs and the decisions involved;
- read the services, the existing tests, and the web app's requests before writing anything;
- wrote the code, tests, and docs, after the user answered the three decisions.

## Suggestions accepted

These are the user's three decisions:

- **Specific messages,** still with code `VALIDATION_ERROR`.
- **Undeclared fields are dropped silently** (`whitelist`), not rejected.
- **Stricter types:** a wrong type is now a 400, where before it was ignored. For example, `PATCH` with `"port": "5433"`, or dev login with a non-string email.

## Suggestions rejected

- **Validating business rules in the DTOs** (lengths, the port range, SSL modes, the allowlist against the snapshot): they stay in the core services, because the worker calls those too. Moving the SSL check would also have turned `SSL_REQUIRED` into a generic `VALIDATION_ERROR`, which the web app and a test rely on.
- **A DTO for the history `limit` and `cursor` query:** the controller clamps a bad `limit` to the allowed range on purpose, and a DTO would turn that into a 400. It is left as it was.

## Decisions

- **The existing messages were kept word for word** for SQL and questions, so the web app shows the same text.
- **`PATCH` fields sent as `null` still mean "not sent".** `PartialType` makes fields optional, which lets `null` through, and `ConnectionService` keeps the saved value for `null` (`??`), as before.
- **`CheckSqlDto` checks only that `sql` is a string.** Empty and overlong SQL stay normal guard answers (`empty`, `too_long`), as before.

## Problems found

- **Decorator order chose the wrong message.** With `@IsString` written above `@MaxLength`, a number was reported as "longer than 2000 characters". TypeScript applies property decorators from the bottom up, and the pipe stops at the first failure. The basic type checks now sit closest to the property, with a comment explaining why. The test caught this; a further test covers `tables` sent as a string.

## What was checked

- **API unit tests:** `npm run test:unit -w @ayd/api` passes 110 of 110 (100 before). No existing HTTP test needed changing.
- **Integration tests:** `npm run test:int` passes 95 of 95. These had not been run since the auth folder move and Swagger stage 1, so this covers those commits too.
- **End-to-end tests:** `npm run test:e2e` passes 3 of 3.
- **Build:** `npm run build -w @ayd/api` passes.
- **Lint:** `npm run lint` passes, with only the known TanStack Virtual warning.
- **Formatting:** `npm run format:check` passes.
- **Audit:** no advisories for the new packages.
- **Live check against the running dev API**, with a throwaway user, deleted afterwards:

  | Request                                        | Answer                               |
  | ---------------------------------------------- | ------------------------------------ |
  | A question sent as a number, or as spaces only | 400 with the specific message        |
  | A valid question on another user's connection  | 404                                  |
  | `PATCH` with the port as text                  | 400 `port must be an integer number` |
  | A bad allowlist column                         | 400 with the path                    |
  | No token and a bad body                        | 401: the guard runs before the pipe  |
  | Dev login with an extra `isAdmin` field        | 200: the field was dropped           |
  | `/docs/openapi.json`                           | lists the 9 DTO schemas              |

- **The web app's request bodies were read** (the connect wizard, the connection page, the allowlist editor, the ask page): they already send the types the DTOs expect.
- **Browser tests:** `npm run test:browser` passes 6 of 6 (the demo flow and axe, on desktop and phone), with the pipe in place.

## Still open

- **Stage 2b:** response schemas for `/docs`, documentation-only classes for what each route returns.
