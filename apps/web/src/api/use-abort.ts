import { useCallback, useEffect, useRef } from 'react';

/**
 * A signal that aborts when the component unmounts, so a job being followed stops when the
 * user leaves the page. The controller is made in the effect, not during render: React
 * mounts, unmounts, and mounts again in development, and a controller made once would
 * already be aborted the second time.
 */
export function useUnmountSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  return useCallback(() => controller.current?.signal ?? AbortSignal.abort(), []);
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
