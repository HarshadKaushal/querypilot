import { useCallback, useState } from 'react';
import type { JobView } from './api-types';
import type { WatchOptions } from './jobs';
import { isAbort, useUnmountSignal } from './use-abort';

/**
 * How a job the page started came out:
 * - `ok: true`: it succeeded, with its result;
 * - `ok: false`: it failed or was cancelled (`error` is its JobError), or the API refused
 *   to start it, for example too many jobs (`error` is an ApiError).
 */
export type JobRun<Result> = { ok: true; result: Result } | { ok: false; error: unknown };

/**
 * Runs a worker job from a page and tracks it, so the page only says what to start and what
 * to do with the outcome. `run` hands `start` the options to follow the job with (a signal
 * that aborts when the page unmounts, and an `onUpdate` that keeps `progress` current), and
 * resolves to the outcome, or to null when the page was left before the job finished.
 * `busy` is true from the moment `run` is called until it resolves, before the first update
 * arrives too.
 *
 * Work that should finish before the progress clears, such as reloading data the job
 * changed, can go at the end of `start`.
 */
export function useJobRunner() {
  const signal = useUnmountSignal();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<JobView | null>(null);

  const run = useCallback(
    async <Result>(
      start: (options: WatchOptions) => Promise<JobView<Result>>,
    ): Promise<JobRun<Result> | null> => {
      setBusy(true);
      try {
        const done = await start({ signal: signal(), onUpdate: setProgress });
        return done.state === 'succeeded' && done.result
          ? { ok: true, result: done.result }
          : { ok: false, error: done.error ?? null };
      } catch (error) {
        // Left the page: there is nothing to show the outcome on.
        if (isAbort(error)) {
          return null;
        }
        return { ok: false, error };
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [signal],
  );

  return { busy, progress, run };
}
