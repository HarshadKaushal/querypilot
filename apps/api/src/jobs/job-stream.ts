import type { JobEvents, JobQueue, JobView } from '@ayd/core';
import type { Request, Response } from 'express';

const FINISHED = new Set<JobView['state']>(['succeeded', 'failed', 'cancelled']);

export interface JobStreamTiming {
  /** A re-read on this interval catches anything the event stream missed. */
  checkEveryMs: number;
  /** A comment line on this interval keeps proxies from closing an idle stream. */
  heartbeatMs: number;
  /** The stream ends after this long; the client reconnects or polls. */
  maxMs: number;
}

export const JOB_STREAM_TIMING: JobStreamTiming = {
  checkEveryMs: 2000,
  heartbeatMs: 15000,
  maxMs: 10 * 60 * 1000,
};

/**
 * Streams a job to its owner as Server-Sent Events: one `job` event with the full view each
 * time it changes, ending after a finished state. The first read happens before any header
 * is sent, so a missing or foreign job is a normal 404.
 */
export async function streamJob(
  deps: { jobs: Pick<JobQueue, 'get'>; events: Pick<JobEvents, 'subscribe'> },
  target: { jobId: string; userId: string; request: Request; response: Response },
  timing: JobStreamTiming = JOB_STREAM_TIMING,
): Promise<void> {
  const { jobId, userId, request, response } = target;
  // 1. Read the job before anything is sent: a missing or foreign job throws NOT_FOUND here,
  // while a normal JSON error can still be returned.
  const first = await deps.jobs.get(jobId, userId);

  // The stream's state. `closed` is checked again after every await, because the client may
  // disconnect, or the job finish, while this function is waiting.
  let closed = false;
  let last = '';
  const timers: NodeJS.Timeout[] = [];
  let unsubscribe = (): void => undefined;

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    // clearInterval also clears a setTimeout timer.
    timers.forEach(clearInterval);
    unsubscribe();
    response.end();
  };
  /** Sends the view if it changed since the last one, and ends after a finished state. */
  const send = (view: JobView): void => {
    const text = JSON.stringify(view);
    if (closed || text === last) {
      return;
    }
    last = text;
    response.write(`event: job\ndata: ${text}\n\n`);
    if (FINISHED.has(view.state)) {
      close();
    }
  };
  /** Reads the job again and sends it. Used on every event, and on a timer as a backstop. */
  const reread = async (): Promise<void> => {
    if (closed) {
      return;
    }
    try {
      send(await deps.jobs.get(jobId, userId));
    } catch {
      // Removed after its result TTL, or Redis is gone: nothing more to say.
      close();
    }
  };

  // 2. Open the stream.
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  // nginx and similar proxies otherwise buffer the stream.
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  request.on('close', close);

  // 3. Send what the job looks like now. A job that already finished ends the stream here.
  send(first);
  if (closed) {
    return;
  }
  // 4. Follow its events.
  unsubscribe = await deps.events.subscribe(jobId, () => void reread());
  if (closed) {
    unsubscribe();
    return;
  }
  // 5. The job may have moved between the first read and the subscription, and that event
  // was missed, so read it once more.
  await reread();
  // 6. Timers: a periodic re-read in case an event is lost, a heartbeat comment so proxies
  // keep the idle connection open, and one deadline after which the client reconnects.
  timers.push(setInterval(() => void reread(), timing.checkEveryMs));
  timers.push(
    setInterval(() => {
      if (!closed) {
        response.write(': keep-alive\n\n');
      }
    }, timing.heartbeatMs),
  );
  timers.push(setTimeout(close, timing.maxMs));
}
