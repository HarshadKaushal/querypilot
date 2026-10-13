import { AppException } from '../errors/app.exception';
import { jobView } from './job-queue.service';

const job = {
  id: '7d1c8e4a-2f6b-4c3d-9e8f-0a1b2c3d4e5f',
  name: 'query.run',
  timestamp: Date.UTC(2026, 9, 13, 10, 0, 0),
  processedOn: undefined as number | undefined,
  finishedOn: undefined as number | undefined,
  returnvalue: undefined as unknown,
};

describe('jobView', () => {
  it.each(['waiting', 'delayed', 'prioritized', 'waiting-children'])(
    'shows %s as queued',
    (state) => {
      expect(jobView(job, state)).toEqual({
        id: job.id,
        kind: 'query.run',
        state: 'queued',
        createdAt: '2026-10-13T10:00:00.000Z',
        startedAt: null,
        finishedAt: null,
      });
    },
  );

  it('shows an active job as running, with its start time', () => {
    const started = { ...job, processedOn: Date.UTC(2026, 9, 13, 10, 0, 1) };
    expect(jobView(started, 'active')).toMatchObject({
      state: 'running',
      startedAt: '2026-10-13T10:00:01.000Z',
    });
  });

  it('shows a completed job with an ok outcome as succeeded, with its result', () => {
    const done = {
      ...job,
      finishedOn: Date.UTC(2026, 9, 13, 10, 0, 2),
      returnvalue: { ok: true, result: { rowCount: 3 } },
    };
    expect(jobView(done, 'completed')).toMatchObject({
      state: 'succeeded',
      result: { rowCount: 3 },
      finishedAt: '2026-10-13T10:00:02.000Z',
    });
  });

  it('shows a completed job with a failed outcome as failed, with its error', () => {
    const error = { code: 'QUERY_TIMEOUT', message: 'Too slow.', retryable: false };
    const done = { ...job, returnvalue: { ok: false, error } };
    const view = jobView(done, 'completed');
    expect(view).toMatchObject({ state: 'failed', error });
    expect(view.result).toBeUndefined();
  });

  it('shows a job BullMQ marked failed as a fixed internal error, never the thrown text', () => {
    const view = jobView({ ...job, returnvalue: null }, 'failed');
    expect(view.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Try again.',
      retryable: true,
    });
  });

  it('treats an unknown state or job kind as not found', () => {
    expect(() => jobView(job, 'unknown')).toThrow(AppException);
    expect(() => jobView({ ...job, name: 'something.else' }, 'waiting')).toThrow(
      AppException,
    );
  });

  it('shows the stage of a running job once the runner has reported one', () => {
    expect(
      jobView({ ...job, progress: { stage: 'running_query' } }, 'active'),
    ).toMatchObject({
      state: 'running',
      stage: 'running_query',
    });
    expect(jobView({ ...job, progress: 0 }, 'active').stage).toBeUndefined();
  });

  it('shows a job its owner cancelled as cancelled, not failed', () => {
    const error = {
      code: 'JOB_CANCELLED',
      message: 'The job was cancelled.',
      retryable: true,
    };
    expect(
      jobView({ ...job, returnvalue: { ok: false, error } }, 'completed'),
    ).toMatchObject({
      state: 'cancelled',
      error,
    });
  });

  it('shows a job waiting to be retried after a crash as queued', () => {
    expect(jobView(job, 'delayed').state).toBe('queued');
  });
});
