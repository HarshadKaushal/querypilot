import type { AskJobRunner } from '../ask/ask-job.runner';
import type { ConnectionJobRunner } from './connection-job.runner';
import type { JobCancellation } from './job-cancellation';
import { JobProcessor, type RunnableJob } from './job-processor';
import type { JobContext } from './job.types';
import type { QueryJobRunner } from './query-job.runner';

const sealed = { passwordCiphertext: 'p', encryptedDataKey: 'k' };

function job(overrides: Partial<RunnableJob> = {}): RunnableJob & {
  updateData: jest.Mock;
  updateProgress: jest.Mock;
} {
  return {
    id: '7d1c8e4a-2f6b-4c3d-9e8f-0a1b2c3d4e5f',
    name: 'query.run',
    data: { userId: 'u1', connectionId: 'c1', sql: 'SELECT 1' },
    updateData: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as RunnableJob & { updateData: jest.Mock; updateProgress: jest.Mock };
}

function processor(
  run: (data: unknown, context: JobContext) => Promise<unknown>,
  requested: () => Promise<boolean> = async () => false,
) {
  const queries = { run: jest.fn(run) } as unknown as QueryJobRunner;
  const connections = { create: jest.fn(run) } as unknown as ConnectionJobRunner;
  const cancellation = { requested: jest.fn(requested) } as unknown as JobCancellation;
  return {
    processor: new JobProcessor(queries, connections, cancellation, {} as AskJobRunner),
    queries,
  };
}

const cancelled = {
  ok: false,
  error: { code: 'JOB_CANCELLED', message: 'The job was cancelled.', retryable: true },
};

describe('JobProcessor.handle', () => {
  it('runs the job and records each stage as progress', async () => {
    const { processor: p } = processor(async (_data, context) => {
      await context.report('checking_sql');
      await context.report('running_query');
      return { ok: true, result: 1 };
    });
    const running = job();
    await expect(p.handle(running, { onSideError: jest.fn() })).resolves.toEqual({
      ok: true,
      result: 1,
    });
    expect(running.updateProgress.mock.calls).toEqual([
      [{ stage: 'checking_sql' }],
      [{ stage: 'running_query' }],
    ]);
  });

  it('ends a job cancelled while it waited without running it', async () => {
    const { processor: p, queries } = processor(
      async () => ({ ok: true, result: 1 }),
      async () => true,
    );
    await expect(p.handle(job(), { onSideError: jest.fn() })).resolves.toEqual(cancelled);
    expect(queries.run).not.toHaveBeenCalled();
  });

  it('turns an abort of the running job into a cancelled outcome, not a crash', async () => {
    const controller = new AbortController();
    const { processor: p } = processor(async (_data, context) => {
      controller.abort('cancelled by its owner');
      context.signal?.throwIfAborted();
      return { ok: true, result: 1 };
    });
    await expect(
      p.handle(job(), { signal: controller.signal, onSideError: jest.fn() }),
    ).resolves.toEqual(cancelled);
  });

  it('catches a request the signal missed at the next stage', async () => {
    let asked = false;
    const { processor: p } = processor(
      async (_data, context) => {
        asked = true;
        await context.report('running_query');
        return { ok: true, result: 1 };
      },
      async () => asked,
    );
    await expect(p.handle(job(), { onSideError: jest.fn() })).resolves.toEqual(cancelled);
  });

  it('lets an unexpected error escape when nothing was cancelled, so BullMQ retries', async () => {
    const { processor: p } = processor(async () => {
      throw new Error('db down');
    });
    await expect(p.handle(job(), { onSideError: jest.fn() })).rejects.toThrow('db down');
  });

  it('reports a failed progress write and carries on', async () => {
    const onSideError = jest.fn();
    const { processor: p } = processor(async (_data, context) => {
      await context.report('connecting');
      return { ok: true, result: 1 };
    });
    const flaky = job({ updateProgress: jest.fn().mockRejectedValue(new Error('blip')) });
    await expect(p.handle(flaky, { onSideError })).resolves.toMatchObject({ ok: true });
    expect(onSideError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('drops sealed credentials from the payload after the job, even a cancelled one', async () => {
    const data = { userId: 'u1', ip: null, pending: { id: 'c1', settings: {}, sealed } };
    for (const requested of [false, true]) {
      const { processor: p } = processor(
        async () => ({ ok: true, result: 1 }),
        async () => requested,
      );
      const create = job({ name: 'connection.create', data });
      await p.handle(create, { onSideError: jest.fn() });
      expect(create.updateData).toHaveBeenCalledWith({
        userId: 'u1',
        ip: null,
        pending: { id: 'c1', settings: {} },
      });
    }
  });

  it('keeps the payload when the job crashes, so a retry still has the credentials', async () => {
    const { processor: p } = processor(async () => {
      throw new Error('boom');
    });
    const create = job({
      name: 'connection.create',
      data: { userId: 'u1', ip: null, pending: { id: 'c1', settings: {}, sealed } },
    });
    await expect(p.handle(create, { onSideError: jest.fn() })).rejects.toThrow('boom');
    expect(create.updateData).not.toHaveBeenCalled();
  });

  it('reports a failed payload cleanup instead of failing finished work', async () => {
    const onSideError = jest.fn();
    const { processor: p } = processor(async () => ({ ok: true, result: 1 }));
    const create = job({
      name: 'connection.create',
      data: { userId: 'u1', ip: null, pending: { id: 'c1', settings: {}, sealed } },
      updateData: jest.fn().mockRejectedValue(new Error('redis blip')),
    });
    await expect(p.handle(create, { onSideError })).resolves.toMatchObject({ ok: true });
    expect(onSideError).toHaveBeenCalledWith(expect.any(Error));
  });
});
