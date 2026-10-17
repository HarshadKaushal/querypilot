import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { job } from '../test/render';
import { ApiError } from './api-client';
import type { JobView } from './api-types';
import type { WatchOptions } from './jobs';
import { useJobRunner } from './use-job-runner';

describe('useJobRunner', () => {
  it('shows progress while the job runs and returns its result', async () => {
    const { result } = renderHook(() => useJobRunner());
    let report: WatchOptions['onUpdate'];
    let finish: (view: JobView<{ id: string }>) => void = () => undefined;
    let pending!: ReturnType<typeof result.current.run<{ id: string }>>;

    act(() => {
      pending = result.current.run<{ id: string }>((options) => {
        report = options.onUpdate;
        return new Promise((resolve) => (finish = resolve));
      });
    });
    // Busy at once, before the first update arrives.
    expect(result.current.busy).toBe(true);
    expect(result.current.progress).toBeNull();

    act(() => report?.(job({ state: 'running', stage: 'checking_access' })));
    expect(result.current.progress?.stage).toBe('checking_access');

    await act(async () => finish(job({ state: 'succeeded', result: { id: 'c1' } })));
    expect(await pending).toEqual({ ok: true, result: { id: 'c1' } });
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('returns the error of a failed job', async () => {
    const { result } = renderHook(() => useJobRunner());
    const error = {
      code: 'NOT_READ_ONLY',
      message: 'Read only, please.',
      retryable: false,
    };
    let ended;
    await act(async () => {
      ended = await result.current.run(async () => job({ state: 'failed', error }));
    });
    expect(ended).toEqual({ ok: false, error });
  });

  it('returns a refused request as an error too', async () => {
    const { result } = renderHook(() => useJobRunner());
    const refused = new ApiError(429, 'TOO_MANY_JOBS', 'Too many jobs.', 'r1');
    let ended;
    await act(async () => {
      ended = await result.current.run(async () => {
        throw refused;
      });
    });
    expect(ended).toEqual({ ok: false, error: refused });
  });

  it('returns null when the page was left before the job finished', async () => {
    const { result } = renderHook(() => useJobRunner());
    let ended: unknown = 'not yet';
    await act(async () => {
      ended = await result.current.run(async () => {
        throw new DOMException('The page was left.', 'AbortError');
      });
    });
    expect(ended).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
