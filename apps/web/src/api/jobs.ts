import { ApiError, type ApiClient } from './client';
import type { JobState, JobView } from './types';

const FINISHED: readonly JobState[] = ['succeeded', 'failed', 'cancelled'];

export function isFinished(view: JobView): boolean {
  return FINISHED.includes(view.state);
}

/**
 * Reads Server-Sent Events as they arrive and returns each job view. The API sends
 * `event: job` with the view as JSON in `data:`, and `: keep-alive` comment lines that
 * carry nothing. A chunk can end in the middle of an event, so the rest is kept for the
 * next chunk.
 */
export class JobEventParser {
  private buffer = '';

  push(chunk: string): JobView[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    const blocks = this.buffer.split('\n\n');
    this.buffer = blocks.pop() ?? '';
    const views: JobView[] = [];
    for (const block of blocks) {
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).trimStart());
        }
      }
      if (event !== 'job' || data.length === 0) {
        continue;
      }
      try {
        views.push(JSON.parse(data.join('\n')) as JobView);
      } catch {
        // A malformed event is skipped; the next one carries the full view again.
      }
    }
    return views;
  }
}

export interface WatchOptions {
  signal?: AbortSignal;
  /** Called with every new view, the first one included. */
  onUpdate?: (view: JobView) => void;
  /** Waits before each reconnect; when they run out, the job is polled instead. */
  retryDelaysMs?: number[];
  pollMs?: number;
  /**
   * A stream silent this long is treated as dead and reconnected. The API sends a
   * keep-alive every 15 seconds, so 45 seconds of nothing means the line is gone (a server
   * restart behind a proxy, or a dropped network) even though it never closed.
   */
  idleMs?: number;
}

/**
 * Follows a job until it finishes and returns its final view. It listens to the job's event
 * stream; if the stream ends early (the server closes it after 10 minutes, or the network
 * drops, or it goes silent), it reconnects, and after repeated failures it polls
 * GET /v1/jobs/:id instead.
 * The stream is read with fetch because EventSource cannot send the Authorization header.
 */
export async function watchJob<Result>(
  api: ApiClient,
  initial: JobView<Result>,
  options: WatchOptions = {},
): Promise<JobView<Result>> {
  const { signal, onUpdate } = options;
  const delays = options.retryDelaysMs ?? [500, 1000, 2000];
  let latest = initial;
  onUpdate?.(latest);
  if (isFinished(latest)) {
    return latest;
  }
  for (let failures = 0; failures <= delays.length;) {
    let progressed = false;
    // One controller per attempt, so a silent stream can be dropped without stopping
    // the whole watch; leaving the page still aborts it through the caller's signal.
    const attempt = new AbortController();
    const forward = () => attempt.abort(signal?.reason);
    signal?.addEventListener('abort', forward, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let silence: ReturnType<typeof setTimeout> | undefined;
    const restartSilence = () => {
      clearTimeout(silence);
      silence = setTimeout(() => {
        attempt.abort(new DOMException('The job stream went silent.', 'TimeoutError'));
        void reader?.cancel().catch(() => undefined);
      }, options.idleMs ?? 45_000);
    };
    try {
      restartSilence();
      const response = await api.stream(`/v1/jobs/${initial.id}/events`, attempt.signal);
      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const parser = new JobEventParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        // Any data counts as a sign of life, keep-alive comments included.
        restartSilence();
        for (const view of parser.push(decoder.decode(value, { stream: true }))) {
          latest = view as JobView<Result>;
          progressed = true;
          onUpdate?.(latest);
          if (isFinished(latest)) {
            await reader.cancel().catch(() => undefined);
            return latest;
          }
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      // Not found, or signed out: reconnecting will not help.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        throw error;
      }
    } finally {
      clearTimeout(silence);
      signal?.removeEventListener('abort', forward);
    }
    // A stream that delivered something was working; only back-to-back failures count.
    failures = progressed ? 0 : failures + 1;
    if (failures <= delays.length) {
      await sleep(delays[Math.max(0, failures - 1)], signal);
    }
  }
  for (;;) {
    latest = await api.get<JobView<Result>>(`/v1/jobs/${initial.id}`, signal);
    onUpdate?.(latest);
    if (isFinished(latest)) {
      return latest;
    }
    await sleep(options.pollMs ?? 1500, signal);
  }
}

/** Posts to a route that answers 202 with a job, then follows the job to its end. */
export async function runJob<Result>(
  api: ApiClient,
  path: string,
  body: unknown,
  options: WatchOptions = {},
): Promise<JobView<Result>> {
  const started = await api.post<JobView<Result>>(path, body);
  return watchJob(api, started, options);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
