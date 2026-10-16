# AI review: response schemas in the API docs (stage 2b)

Date: 2026-10-16
Base commit: `901978c` (feat: validate request bodies with DTO classes and class-validator)

## What changed

- **Response classes in `*.responses.ts` beside each controller,** for the docs only. Nothing checks them at run time. Request bodies stay in `*.dto.ts`.
  - `auth/sign-in/auth.responses.ts`: `SessionDto`
  - `auth/user.ts`: `PublicUserDto`, exported from `auth/index.ts`
  - `users/users.responses.ts`: `CurrentUserDto`
  - `connections/connection.responses.ts`: `ConnectionDto`
  - `jobs/jobs.responses.ts`:
    - `JobViewDto`, whose `result` is a `oneOf` of the four result types;
    - `JobErrorDto` and `QueryJobResultDto`;
    - `AskResultDto` with `ChartSpecDto`, `ResultFactsDto`, `LlmAttemptDto`, `AskUsageDto`, and `AskSummaryDto`.
  - `schema/schema.responses.ts`: `RefreshSummaryDto`, `SchemaViewDto`, and `AllowlistViewDto`, with their table and column classes
  - `history/history.responses.ts`: `HistoryEntryDto` and `HistoryPageDto`
  - `sql-guard/sql-guard.responses.ts`: `SqlCheckResultDto`
  - `usage/usage.responses.ts`: `UsageTodayDto`
  - `egress/egress.responses.ts`: `EgressDto`
  - `health/health.responses.ts`: `LiveDto` and `HealthReportDto`
- **Controllers:**
  - every success `@ApiResponse` now has `type`;
  - `JobsController` registers the result classes with `@ApiExtraModels`;
  - the job events stream is documented as `text/event-stream`, with an example event and the keep-alive lines.
- **Return types:** usage, egress, `users/me`, `health/live`, and `AuthController.sessionBody` now declare their response class as their return type. `sessionBody` takes `SessionResult` instead of a hand-copied user shape.
- **Corrected description:** `PUT /allowlist` returns the schema view, not the allowlist, as the stage 1 description wrongly said.
- **`openapi.spec.ts`:**
  - the padlock test now reads Nest's `GUARDS_METADATA` and matches each operation to its controller method through the `operationId`, instead of guessing from tags;
  - new: every success response with a body has a schema;
  - new: every `$ref` resolves.
- **Docs:** README, `docs/features.md`, `docs/implementation.md`, `docs/testing.md`, and `docs/CONTEXT.md`.

## AI usage

An AI assistant (Claude Code) did the following:

- read every service return type in `packages/core` and `packages/shared` before writing the classes;
- checked each value or format it was unsure of against the code: the `newObjects` dotted names, the model failure kinds, the event-stream format, and what `PUT /allowlist` returns;
- wrote the code, tests, and docs.

## Suggestions accepted

- **Response classes `implements` the server's interfaces,** so the compiler catches drift.
- **Where a controller builds the response,** the class is the method's return type.
- **A padlock test based on the real guard metadata,** suggested earlier as a weakness of the tag-based test.

## Suggestions rejected

- **Checking responses at run time** (a response-validating interceptor): it costs time on every request, and the compiler checks give most of the benefit.
- **An exception in the test for the event stream:** the stream was documented properly instead.

## Decisions

- **Separate files:** `*.dto.ts` is what a client sends (validated); `*.responses.ts` is what it gets back (docs only).
- **Unions are single classes with case-labelled fields.** `AskResult` and `SqlCheckResult` cannot be `implements`-checked, so they rely on the description.
- **`JobViewDto.result` is a `oneOf`** with the mapping from job kind written in its description. OpenAPI 3.0 cannot tie the shape to the value of `kind` without a discriminator inside the result, which these results do not have.

## Problems found

- **The stage 1 `PUT /allowlist` description was wrong;** it is corrected.
- **A first draft of the model `outcome` description named a "timeout" kind that does not exist.** It now lists the real `LlmFailureKind` values.
- **A first draft of the success-schema test read `responses[200]`,** which does not exist on 202-only routes. It was fixed before running.

The new checks were shown to fail when they should:

| Break                                                  | Caught by                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `@UseGuards(AuthGuard)` removed from `UsageController` | the padlock test names `GET /v1/usage`                                                 |
| `@ApiExtraModels` removed                              | the `$ref` test lists the three missing schemas                                        |
| `keyVersion` deleted from `ConnectionDto`              | the compiler: "Property 'keyVersion' is missing … required in type 'PublicConnection'" |

## What was checked

- **API unit tests:** `npm run test:unit -w @ayd/api` passes 112 of 112.
- **End-to-end tests:** `npm run test:e2e` passes 3 of 3; they boot the real `AppModule` with the new classes.
- **Build:** `npm run build -w @ayd/api` passes.
- **Lint:** `npm run lint` passes, with only the known TanStack Virtual warning.
- **Formatting:** `npm run format:check` passes.
- **Live check against the running dev API,** with a throwaway user, deleted afterwards. Real responses were compared with their documented schemas: no undocumented fields, and no missing required ones. The routes were dev login, `users/me`, usage, the connections list, the history list, egress, `health/live`, and `health/ready`. The connections and history lists were empty, so only their outer shape was compared; their items are covered by `implements`.
- **Not run:** `test:int` and `test:browser`. This change adds documentation metadata and type annotations only; no request handling changed.

## Still open

- **Optional:** generate `apps/web/src/api/types.ts` from `/docs/openapi.json` (for example with `openapi-typescript`), so the web app's copy of the API types cannot drift.
