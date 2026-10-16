# AI review: group the API's auth folder by job

Date: 2026-10-16
Base commit: `f15230d` (docs: add a shared session context file and a rule to keep it current)

## What changed

The files were moved, not rewritten. No logic changed.

- **`apps/api/src/auth/` is now grouped by job** instead of one flat list of 13 files:
  - `protect-routes/`: `auth.guard.ts`, `current-user.decorator.ts`
  - `sign-in/`: `auth.controller.ts`, `auth.service.ts`, `cookies.ts`, `google.client.ts`, and their two spec files
  - `tokens/`: `token.service.ts` and its spec
  - `storage/`: `auth.repository.ts`, `prisma-auth.repository.ts`
  - `auth.module.ts` stays at the top.
- **`auth/index.ts` (new):** the folder's public surface. It exports `AuthModule`, `AuthGuard`, `CurrentUser`, the `PublicUser` type, and `AuthService` (the users controller uses it for account deletion). A comment at the top says what each subfolder is for.
- **`auth/user.ts` (new):** `PublicUser` and `toPublicUser`, moved out of `auth.repository.ts`. Seven controllers used the type, and they no longer import it from a storage file.
- **`common/request-meta.ts` (new):** `requestMeta` moved out of `cookies.ts`, which it had nothing to do with. Its `RequestMeta` type replaces a second, identical copy that was written out in `auth.service.ts`.
- **Imports:**
  - The seven feature controllers and eight modules (`app.module.ts` included) now import from `'../auth'`.
  - Test wiring (`testing/http-app.ts`, `testing/memory-auth.repository.ts`, and `auth-repository.int-spec.ts`) imports the internal files directly, because it builds auth from its parts.
- **`docs/implementation.md`:** the new layout under Phase 1, and the import rule under "How to extend this".

## AI usage

An AI assistant (Claude Code) did the following:

- proposed the layout, which the user approved;
- moved the files with `git mv`, so history follows them;
- rewrote the controller imports with a small script, run on 7 named files, and made the other edits by hand.

## Suggestions accepted

- Folders named after jobs (`protect-routes/`, `sign-in/`, `tokens/`, `storage/`), not after file types (`controllers/`, `services/`).
- An `index.ts` as the folder's front door.
- `PublicUser` and `requestMeta` moved to homes that match what they are.

## Suggestions rejected

- **Dropping the `auth.` prefix inside the folders** (for example `storage/repository.ts`): kept, so quick open and editor tabs can tell `auth.repository.ts` apart from other repositories.
- **Structural changes discussed in the same conversation**, left for later and each needing the user's go-ahead:
  - a global guard with `@Public()`;
  - `@Cookie()` and `@ClientMeta()` parameter decorators;
  - moving account deletion to a `UsersService`;
  - splitting `TokenService`;
  - DTO validation.

## Decisions

- **`AuthService` is exported from `index.ts`,** because `UsersController.deleteMe` calls `deleteAccount`. If account deletion moves to a `UsersService` later, this export can go.
- **Test wiring may import auth's internal files.** The `index.ts` rule is for feature code.

## Problems found

- **Running `tsc -p apps/api/tsconfig.json --noEmit` directly reports many `TS6059` errors** (a file outside `rootDir`) for `@ayd/core/testing`. These come from how that config resolves the package outside the build scripts, not from this change. No other error codes appeared.
- **`tsc` does not delete old output,** so `apps/api/dist/auth/` kept copies of the old flat files. They were removed by hand. `dist` is git-ignored and rebuilt on every build.
- **One API unit test failed once (1 of 94),** right after the package builds that `test:unit` runs. The output was not saved, so it is not known which test. Three later runs passed 94 of 94. A broken import would fail every run, so the move is unlikely to be the cause.

## What was checked

- **Build:** `npm run build -w @ayd/api` passes.
- **API unit tests:** 94 of 94 passed on three runs, after one earlier run with 1 failure (see "Problems found").
- **The real `AppModule` compiles:** compiled from `dist` with `@nestjs/testing`, without starting the app. This checks the dependency graph and that importing through `index.ts` has no import-order problem. All four public exports load.
- **Lint:** `npm run lint` passes, with only the known TanStack Virtual warning.
- **Formatting:** Prettier made no changes to the moved or edited files.
- **Not run:**
  - `test:int` and `test:e2e`, because Docker Desktop was not running. `auth-repository.int-spec.ts` had only its import paths changed.
  - Web tests, because the web app was not touched.

## Still open

- **Find the intermittent API unit test** if it fails again. Save the full Jest output when it does.
- **Run `npm run test:int` and `npm run test:e2e`** the next time Docker is up.
