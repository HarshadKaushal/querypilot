# AI review: one hook for running jobs, and Mantine's form in the connect wizard

Date: 2026-10-18
Base commit: `a3f0ba1` (refactor: split the question runner into named steps and share the run-SQL sequence)

## What changed

This is commit 3 of 4 in the readability cleanup. The web app had a lot of `useState` and hand-written `onChange` code. An audit found it came from two places:

- one real form whose seven fields were wired by hand;
- the same "run a job and show its progress" block, copied into five components.

**The job pattern is now one hook, `lib/use-job-runner.ts`.**

- A page calls `job.run((options) => askQuestion(api, id, text, options))`.
- The hook handles everything else:
  - the abort signal, so the job stops being followed when the page is left;
  - `onUpdate` progress;
  - telling success from a failed job from a refused request;
  - ignoring the abort when the page is left;
  - clearing the progress afterwards.
- It returns `{ ok: true, result }`, `{ ok: false, error }`, or `null` when the page was left.
- `busy` is true from the moment of the click. `progress` holds the latest job view.

The five pages that use it are `AskPage`, `HistoryPage` (`HistoryCard`), `ConnectionPage`, `AllowlistSection`, and `ConnectWizardPage`.

- In `AskPage`, the `as AskResult` and `as QueryJobResult` casts are gone. Each mode now calls `run` with its own typed function.
- In `AllowlistSection`, the allowlist reload stays _inside_ the job step. That way the progress clears only after the new allowlist has loaded, as before. Otherwise the "schema has not been read yet" notice would flash.

**The connect wizard uses `useForm` from `@mantine/form`** (new dependency, 9.7.2, the same version as `@mantine/core`).

- `{...form.getInputProps('host')}` replaces `value`, `onChange`, and `error` on each field.
- `form.onSubmit(save)` replaces the manual `preventDefault` and the "any errors?" check.
- `validateConnection` is unchanged and is passed as `validate`.
- The SSL `Select` keeps an explicit `onChange`, because it hands back `string | null`.

**Other changes:**

- **`lib/notify.ts`: `notifyError(title, error)`** replaces four copies of the red toast code (history, connections list, and the connection page).
- **`AskPage`:** a failure to load the connections now shows `ErrorAlert`, like every other page, instead of `FailureView connectionId=""`.
- **`lib/use-job-runner.spec.ts` (new, 4 tests):** progress and result, failed job, refused request, and leaving the page.

## AI usage

An AI assistant (Claude Code) did the following:

- counted the 68 `useState`/`onChange` uses and showed that a form library helps only the wizard;
- recommended `@mantine/form` over react-hook-form. Mantine's inputs are controlled, and react-hook-form would need a `<Controller>` around each one;
- wrote the hook and the changes, then the spec.

## Suggestions accepted

- **`@mantine/form` in the wizard only,** at the user's request.
- **Plain `useState` stays for one- or two-field inputs:** the sign-in dev form, the settings "type DELETE" box, and the ask text box. A form library adds nothing there.

## Suggestions rejected

- **Using TanStack Query's `useMutation` for jobs:** a job is followed over a stream with progress, which a mutation does not model. The hook stays small and specific.

## Decisions

- **`busy` starts at the click** instead of at the first progress update. "Run again" in history and "Test connection" are now disabled from the click, so a double click cannot start two jobs.
- **A field's error now clears as soon as the field is edited.** This is the default for Mantine's form. Before, errors stayed until the next submit.

## Problems found

- **A misleading message in the wizard, fixed.** If the API refused the schema read after the connection was saved (for example, too many jobs), the old code showed "The connection was not saved" on the form step. Now that error is passed to the next step as a schema-read error, which is what happened. `AllowlistSection`'s `initialReadError` prop therefore accepts any error, not only a `JobError`; its own state already did.
- **Small differences:** after a failed connection test, or a "run again" that the API refused, the page now refetches the connection or history even when the request itself was refused. That costs one extra harmless refetch.

## What was checked

- **Type-check:** `tsc -p apps/web/tsconfig.json --noEmit` passes.
- **Web tests:** 72 of 72. These are the 68 that existed and are unchanged, including the wizard's save, refuse, and field-check tests, plus the 4 new hook tests.
- **Lint:** passes, with only the known TanStack Virtual warning.
- **`vite build`:** passes. The main bundle is 714.7 kB before compression; 695 kB was measured on 2026-10-16, before the form library and the other changes since.
- **`npm audit`:** `@mantine/form` adds no advisory. The findings listed are the existing Jest, Sequelize, and uuid ones.
- **Not run yet:** the browser tests (`npm run test:browser`), because Docker Desktop is not running. The demo flow fills in the connect wizard, so it is the main remaining check for this commit.

## Still open

- Run `npm run test:browser` and `npm run test:int` once Docker is up.
