import {
  ADDRESS_RESOLVER,
  CONNECTION_REPOSITORY,
  ConnectionService,
  JobEvents,
  JobQueue,
  notFound,
  UserDatabaseProbe,
  type JobEventType,
  type JobView,
} from '@ayd/core';
import { MemoryConnectionRepository } from '@ayd/core/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from '../testing/http-app';
import { JOB_STREAM_TIMING_TOKEN, JobsController } from './jobs.controller';

const JOB_ID = '7d1c8e4a-2f6b-4c3d-9e8f-0a1b2c3d4e5f';

function view(state: JobView['state'], extra: Partial<JobView> = {}): JobView {
  return {
    id: JOB_ID,
    kind: 'query.run',
    state,
    createdAt: '2026-10-13T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...extra,
  };
}

/** Reads an SSE body into its `job` events. */
function events(body: string): JobView[] {
  return body
    .split('\n\n')
    .filter((block) => block.startsWith('event: job'))
    .map((block) => JSON.parse(block.split('\ndata: ')[1]!) as JobView);
}

/** A supertest parser that keeps the raw stream text. */
const collect = ((
  res: NodeJS.ReadableStream,
  done: (error: Error | null, body: string) => void,
) => {
  let text = '';
  res.setEncoding('utf8');
  res.on('data', (chunk: string) => (text += chunk));
  res.on('end', () => done(null, text));
}) as unknown as Parameters<request.Test['parse']>[0];

describe('job stream and cancel routes', () => {
  let app: INestApplication;
  let owner = '';
  let current: JobView;
  let onSubscribe: (fire: (type: JobEventType) => void) => void;
  const jobs = {
    add: jest.fn(),
    get: jest.fn(async (_id: string, userId: string) => {
      if (userId !== owner) {
        throw notFound();
      }
      return current;
    }),
    cancel: jest.fn(),
  };
  const jobEvents = {
    subscribe: jest.fn(async (_id: string, listener: (type: JobEventType) => void) => {
      onSubscribe(listener);
      return () => undefined;
    }),
  };

  beforeEach(async () => {
    onSubscribe = () => undefined;
    jobs.cancel.mockReset();
    app = await createHttpApp({
      controllers: [JobsController],
      providers: [
        ConnectionService,
        { provide: CONNECTION_REPOSITORY, useValue: new MemoryConnectionRepository() },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: {} },
        { provide: JobQueue, useValue: jobs },
        { provide: JobEvents, useValue: jobEvents },
        {
          provide: JOB_STREAM_TIMING_TOKEN,
          useValue: { checkEveryMs: 30, heartbeatMs: 10, maxMs: 2000 },
        },
      ],
      requestId: 'req-stream-01',
    });
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email: 'dev@localhost', name: 'Dev' });
    owner = login.body.user.id;
    token = login.body.accessToken;
  });
  let token = '';

  afterEach(async () => {
    await app.close();
  });

  function stream() {
    return request(app.getHttpServer())
      .get(`/v1/jobs/${JOB_ID}/events`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse(collect);
  }

  it('sends a finished job once and ends the stream', async () => {
    current = view('succeeded', { result: { rowCount: 2 } });
    const response = await stream();
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(events(response.body as string)).toEqual([current]);
  });

  it('sends each change the events report, then the final state', async () => {
    current = view('queued');
    onSubscribe = (fire) => {
      setTimeout(() => {
        current = view('running', { stage: 'running_query' });
        fire('progress');
        setTimeout(() => {
          current = view('succeeded', { result: { rowCount: 1 } });
          fire('completed');
        }, 20);
      }, 20);
    };
    const response = await stream();
    expect(events(response.body as string).map((job) => [job.state, job.stage])).toEqual([
      ['queued', undefined],
      ['running', 'running_query'],
      ['succeeded', undefined],
    ]);
  });

  it('notices a change with no event through its regular re-read, and sends keep-alives', async () => {
    current = view('running');
    setTimeout(() => {
      current = view('cancelled', {
        error: {
          code: 'JOB_CANCELLED',
          message: 'The job was cancelled.',
          retryable: true,
        },
      });
    }, 80);
    const response = await stream();
    const body = response.body as string;
    expect(events(body).map((job) => job.state)).toEqual(['running', 'cancelled']);
    expect(body).toContain(': keep-alive');
  });

  it('answers 404 with the error envelope, not a stream, for a job that is not yours', async () => {
    owner = 'someone-else';
    const response = await request(app.getHttpServer())
      .get(`/v1/jobs/${JOB_ID}/events`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: 'req-stream-01',
    });
  });

  it('requires a signed-in user', async () => {
    const response = await request(app.getHttpServer()).get(`/v1/jobs/${JOB_ID}/events`);
    expect(response.status).toBe(401);
  });

  it('answers 202 for a cancel request and 200 for a job that already finished', async () => {
    jobs.cancel.mockResolvedValueOnce(view('running', { cancelRequested: true }));
    const asked = await request(app.getHttpServer())
      .post(`/v1/jobs/${JOB_ID}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(asked.status).toBe(202);
    expect(asked.body).toMatchObject({ state: 'running', cancelRequested: true });
    expect(jobs.cancel).toHaveBeenCalledWith(JOB_ID, owner);

    jobs.cancel.mockResolvedValueOnce(view('succeeded'));
    const late = await request(app.getHttpServer())
      .post(`/v1/jobs/${JOB_ID}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    expect(late.status).toBe(200);
    expect(late.body.state).toBe('succeeded');
  });
});
