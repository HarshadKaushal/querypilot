import {
  ADDRESS_RESOLVER,
  AppException,
  CONNECTION_REPOSITORY,
  ConnectionService,
  JobEvents,
  JobQueue,
  notFound,
  UserDatabaseProbe,
  type JobView,
} from '@ayd/core';
import { MemoryConnectionRepository } from '@ayd/core/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ConnectionsController } from '../connections/connections.controller';
import { createHttpApp } from '../testing/http-app';
import { JobsController } from './jobs.controller';

const JOB_ID = '7d1c8e4a-2f6b-4c3d-9e8f-0a1b2c3d4e5f';

function queued(kind: string): JobView {
  return {
    id: JOB_ID,
    kind: kind as JobView['kind'],
    state: 'queued',
    createdAt: '2026-10-13T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
}

describe('job routes', () => {
  let app: INestApplication;
  const connections = new MemoryConnectionRepository();
  const jobs = { add: jest.fn(), get: jest.fn(), cancel: jest.fn() };

  beforeEach(async () => {
    connections.rows.length = 0;
    jobs.add.mockReset().mockImplementation(async (kind: string) => queued(kind));
    jobs.get.mockReset();
    app = await createHttpApp({
      controllers: [ConnectionsController, JobsController],
      providers: [
        ConnectionService,
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: { test: async () => ({ ok: true }) } },
        { provide: JobQueue, useValue: jobs },
        { provide: JobEvents, useValue: { subscribe: async () => () => undefined } },
      ],
      requestId: 'req-jobs-01',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function signedIn(email = 'dev@localhost') {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email, name: 'Dev' });
    return {
      token: login.body.accessToken as string,
      userId: login.body.user.id as string,
    };
  }

  /** Saves a connection directly; the route that creates one queues a job. */
  async function connection(userId: string) {
    const created = await app.get(ConnectionService).create(
      userId,
      {
        label: 'Sample',
        host: 'db.example',
        port: 5432,
        databaseName: 'sample',
        username: 'sample_ro',
        password: 'sample_ro_password',
        sslMode: 'require',
      },
      null,
    );
    return created.id;
  }

  function submit(token: string, connectionId: string, body: unknown) {
    return request(app.getHttpServer())
      .post(`/v1/connections/${connectionId}/queries`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  }

  it('requires a signed-in user for both routes', async () => {
    const server = app.getHttpServer();
    expect(
      (await request(server).post('/v1/connections/x/queries').send({})).status,
    ).toBe(401);
    expect((await request(server).get(`/v1/jobs/${JOB_ID}`)).status).toBe(401);
  });

  it('queues the SQL for the owner and answers 202 with the job at once', async () => {
    const { token, userId } = await signedIn();
    const id = await connection(userId);
    const response = await submit(token, id, { sql: 'SELECT id FROM orders' });
    expect(response.status).toBe(202);
    expect(response.body).toEqual(queued('query.run'));
    expect(jobs.add).toHaveBeenCalledWith('query.run', {
      userId,
      connectionId: id,
      sql: 'SELECT id FROM orders',
    });
  });

  it.each([{}, { sql: 42 }, { sql: '   ' }, { sql: 'x'.repeat(20001) }])(
    'refuses a body without usable SQL (%#) and queues nothing',
    async (body) => {
      const { token, userId } = await signedIn();
      const id = await connection(userId);
      const response = await submit(token, id, body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(jobs.add).not.toHaveBeenCalled();
    },
  );

  it("answers 404 for someone else's connection and queues nothing", async () => {
    const owner = await signedIn('owner@example.test');
    const id = await connection(owner.userId);
    const other = await signedIn('other@example.test');
    const response = await submit(other.token, id, { sql: 'SELECT 1' });
    expect(response.status).toBe(404);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it('reads a job for its owner, and passes NOT_FOUND through for anyone else', async () => {
    const { token, userId } = await signedIn();
    jobs.get.mockImplementation(async (jobId: string, ownerId: string) => {
      if (ownerId !== userId) {
        throw notFound();
      }
      return {
        ...queued('query.run'),
        id: jobId,
        state: 'succeeded',
        result: { rowCount: 1 },
      };
    });
    const mine = await request(app.getHttpServer())
      .get(`/v1/jobs/${JOB_ID}`)
      .set('Authorization', `Bearer ${token}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({
      id: JOB_ID,
      state: 'succeeded',
      result: { rowCount: 1 },
    });

    const other = await signedIn('other@example.test');
    const theirs = await request(app.getHttpServer())
      .get(`/v1/jobs/${JOB_ID}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: 'req-jobs-01',
    });
  });

  it('answers 429 with the error envelope when the user already has too many jobs', async () => {
    const { token, userId } = await signedIn();
    const id = await connection(userId);
    jobs.add.mockRejectedValueOnce(
      new AppException(
        'TOO_MANY_JOBS',
        'You already have 3 jobs waiting or running. Wait for one to finish, or cancel one.',
        429,
      ),
    );
    const response = await submit(token, id, { sql: 'SELECT 1' });
    expect(response.status).toBe(429);
    expect(response.body.error).toEqual({
      code: 'TOO_MANY_JOBS',
      message:
        'You already have 3 jobs waiting or running. Wait for one to finish, or cancel one.',
      requestId: 'req-jobs-01',
    });
  });
});
