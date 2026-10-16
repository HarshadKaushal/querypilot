import { describe, expect, it, vi } from 'vitest';
import { eventStream, fakeApi, job } from '../test/render';
import { ApiError } from './api-client';
import { JobEventParser, watchJob } from './jobs';

const FAST = { retryDelaysMs: [0, 0], pollMs: 0 };

describe('JobEventParser', () => {
  it('returns job events, skips keep-alive comments, and keeps a half-received event', () => {
    const parser = new JobEventParser();
    const first = JSON.stringify(job({ state: 'running' }));
    const second = JSON.stringify(job({ state: 'succeeded' }));
    const text = `: keep-alive\n\nevent: job\ndata: ${first}\n\nevent: job\ndata: ${second}\n\n`;
    const cut = text.length - 20;
    expect(parser.push(text.slice(0, cut)).map((v) => v.state)).toEqual(['running']);
    expect(parser.push(text.slice(cut)).map((v) => v.state)).toEqual(['succeeded']);
  });

  it('accepts CRLF line endings and ignores other events and broken JSON', () => {
    const parser = new JobEventParser();
    const views = parser.push(
      `event: other\r\ndata: {}\r\n\r\nevent: job\r\ndata: {broken\r\n\r\nevent: job\r\ndata: ${JSON.stringify(job())}\r\n\r\n`,
    );
    expect(views).toHaveLength(1);
  });
});

describe('watchJob', () => {
  it('follows the stream until the job finishes, reporting each view', async () => {
    const api = fakeApi({
      stream: vi
        .fn()
        .mockResolvedValue(
          eventStream(
            job({ state: 'running', stage: 'checking_access' }),
            job({ state: 'succeeded', result: { id: 'c1' } }),
          ),
        ),
    });
    const seen: string[] = [];
    const done = await watchJob(api, job(), {
      ...FAST,
      onUpdate: (view) => seen.push(view.stage ?? view.state),
    });
    expect(done).toMatchObject({ state: 'succeeded', result: { id: 'c1' } });
    expect(seen).toEqual(['queued', 'checking_access', 'succeeded']);
    expect(api.stream).toHaveBeenCalledWith(
      '/v1/jobs/j1/events',
      expect.any(AbortSignal),
    );
  });

  it('returns at once for a job that has already finished', async () => {
    const api = fakeApi();
    const done = await watchJob(api, job({ state: 'failed' }), FAST);
    expect(done.state).toBe('failed');
    expect(api.stream).not.toHaveBeenCalled();
  });

  it('reconnects when the stream ends before the job does', async () => {
    const api = fakeApi({
      stream: vi
        .fn()
        .mockResolvedValueOnce(eventStream(job({ state: 'running' })))
        .mockResolvedValueOnce(eventStream(job({ state: 'cancelled' }))),
    });
    expect((await watchJob(api, job(), FAST)).state).toBe('cancelled');
    expect(api.stream).toHaveBeenCalledTimes(2);
  });

  it('drops a stream that goes silent without closing, and reconnects', async () => {
    // A server restart behind the dev proxy leaves the browser's stream open but empty.
    const encoder = new TextEncoder();
    const silent = new ReadableStream<Uint8Array>({
      start(controller) {
        const view = JSON.stringify(job({ state: 'running' }));
        controller.enqueue(encoder.encode(`event: job\ndata: ${view}\n\n`));
        // Never closed and never written to again.
      },
    });
    const api = fakeApi({
      stream: vi
        .fn()
        .mockResolvedValueOnce(new Response(silent))
        .mockResolvedValueOnce(eventStream(job({ state: 'failed' }))),
    });
    const done = await watchJob(api, job(), { ...FAST, idleMs: 30 });
    expect(done.state).toBe('failed');
    expect(api.stream).toHaveBeenCalledTimes(2);
  });

  it('keeps a stream that is quiet but sends keep-alives', async () => {
    const encoder = new TextEncoder();
    const keepAlive = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < 4; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }
        const view = JSON.stringify(job({ state: 'succeeded' }));
        controller.enqueue(encoder.encode(`event: job\ndata: ${view}\n\n`));
        controller.close();
      },
    });
    const api = fakeApi({ stream: vi.fn().mockResolvedValue(new Response(keepAlive)) });
    // 60 ms of keep-alives in total, each gap under the 40 ms limit.
    expect((await watchJob(api, job(), { ...FAST, idleMs: 40 })).state).toBe('succeeded');
    expect(api.stream).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when the stream keeps failing', async () => {
    const api = fakeApi({
      stream: vi.fn().mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline')),
      get: vi
        .fn()
        .mockResolvedValueOnce(job({ state: 'running' }))
        .mockResolvedValueOnce(job({ state: 'succeeded' })),
    });
    expect((await watchJob(api, job(), FAST)).state).toBe('succeeded');
    expect(api.stream).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenCalledWith('/v1/jobs/j1', undefined);
  });

  it('stops on a 4xx, such as a job that no longer exists', async () => {
    const api = fakeApi({
      stream: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found.')),
    });
    await expect(watchJob(api, job(), FAST)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(api.stream).toHaveBeenCalledTimes(1);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const api = fakeApi({
      stream: vi.fn().mockImplementation(async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }),
    });
    await expect(
      watchJob(api, job(), { ...FAST, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
