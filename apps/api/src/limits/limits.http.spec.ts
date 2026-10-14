import {
  ADDRESS_RESOLVER,
  AppException,
  CONNECTION_REPOSITORY,
  ConnectionService,
  JobEvents,
  JobQueue,
  QUERY_HISTORY,
  RateLimiter,
  USAGE_COUNTERS,
  UserDatabaseProbe,
  utcDay,
  type JobView,
} from '@ayd/core';
import { MemoryConnectionRepository, MemoryUsageCounters } from '@ayd/core/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HistoryController } from '../history/history.controller';
import { JobsController } from '../jobs/jobs.controller';
import { createHttpApp } from '../testing/http-app';
import { testEnv } from '../testing/test-env';
import { UsageController } from '../usage/usage.controller';

function queued(kind: string): JobView {
  return {
    id: '7d1c8e4a-2f6b-4c3d-9e8f-0a1b2c3d4e5f',
    kind: kind as JobView['kind'],
    state: 'queued',
    createdAt: '2026-10-14T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
}

// Small limits so a test can reach them: 3 questions a day, 4 submissions a minute,
// 5 auth requests a minute.
const ENV = testEnv({
  DEV_LOGIN_ENABLED: 'true',
  QUESTIONS_PER_DAY: '3',
  SUBMISSIONS_PER_MINUTE: '4',
  AUTH_REQUESTS_PER_MINUTE: '5',
});

describe('limits and usage', () => {
  let app: INestApplication;
  let usage: MemoryUsageCounters;
  const connections = new MemoryConnectionRepository();
  const jobs = { add: jest.fn(), get: jest.fn(), cancel: jest.fn() };
  const history = {
    list: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    deleteAll: jest.fn(),
    record: jest.fn(),
  };

  beforeEach(async () => {
    connections.rows.length = 0;
    usage = new MemoryUsageCounters();
    jobs.add.mockReset().mockImplementation(async (kind: string) => queued(kind));
    history.get.mockReset();
    app = await createHttpApp({
      env: ENV,
      controllers: [JobsController, HistoryController, UsageController],
      providers: [
        ConnectionService,
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: { test: async () => ({ ok: true }) } },
        { provide: JobQueue, useValue: jobs },
        { provide: JobEvents, useValue: { subscribe: async () => () => undefined } },
        { provide: QUERY_HISTORY, useValue: history },
        { provide: USAGE_COUNTERS, useValue: usage },
      ],
      requestId: 'req-limits-01',
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

  function post(token: string, path: string, body: object = {}) {
    return request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function usageNow(token: string) {
    return request(app.getHttpServer())
      .get('/v1/usage')
      .set('Authorization', `Bearer ${token}`);
  }

  it('answers 429 RATE_LIMITED with Retry-After past the per-minute limit, across routes', async () => {
    const { token, userId } = await signedIn();
    const id = await connection(userId);
    history.get.mockResolvedValue({ id: 'h1', connectionId: id, sql: 'SELECT 1' });
    // Questions, SQL, and re-runs share one allowance of 4.
    expect(
      (await post(token, `/v1/connections/${id}/queries`, { sql: 'SELECT 1' })).status,
    ).toBe(202);
    expect(
      (await post(token, `/v1/connections/${id}/questions`, { question: 'How many?' }))
        .status,
    ).toBe(202);
    expect((await post(token, '/v1/history/h1/rerun')).status).toBe(202);
    expect(
      (await post(token, `/v1/connections/${id}/queries`, { sql: 'SELECT 1' })).status,
    ).toBe(202);

    const limited = await post(token, `/v1/connections/${id}/queries`, {
      sql: 'SELECT 1',
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      requestId: 'req-limits-01',
    });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect((await post(token, '/v1/history/h1/rerun')).status).toBe(429);
    expect(jobs.add).toHaveBeenCalledTimes(4);
  });

  it('keeps one user’s limit away from another user', async () => {
    const first = await signedIn('first@localhost');
    const second = await signedIn('second@localhost');
    const firstId = await connection(first.userId);
    const secondId = await connection(second.userId);
    for (let i = 0; i < 4; i += 1) {
      await post(first.token, `/v1/connections/${firstId}/queries`, { sql: 'SELECT 1' });
    }
    expect(
      (await post(first.token, `/v1/connections/${firstId}/queries`, { sql: 'SELECT 1' }))
        .status,
    ).toBe(429);
    expect(
      (
        await post(second.token, `/v1/connections/${secondId}/queries`, {
          sql: 'SELECT 1',
        })
      ).status,
    ).toBe(202);
  });

  it('answers 429 QUOTA_EXCEEDED once the day’s questions are used, with Retry-After to midnight UTC', async () => {
    const { token, userId } = await signedIn();
    const id = await connection(userId);
    // The per-minute limit (4) is above the daily one (3) here, so the quota is what stops it.
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await post(token, `/v1/connections/${id}/questions`, { question: `Q${i}` }))
          .status,
      ).toBe(202);
    }
    const over = await post(token, `/v1/connections/${id}/questions`, {
      question: 'One more',
    });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe('QUOTA_EXCEEDED');
    const retryAfter = Number(over.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(86_400);
    expect(jobs.add).toHaveBeenCalledTimes(3);
  });

  it('does not count a question that fails validation, belongs to someone else, or is not queued', async () => {
    const owner = await signedIn('owner@localhost');
    const other = await signedIn('other@localhost');
    const id = await connection(owner.userId);
    expect(
      (await post(owner.token, `/v1/connections/${id}/questions`, { question: '' }))
        .status,
    ).toBe(400);
    expect(
      (await post(other.token, `/v1/connections/${id}/questions`, { question: 'Hi' }))
        .status,
    ).toBe(404);
    jobs.add.mockRejectedValueOnce(
      new AppException('TOO_MANY_JOBS', 'You already have 3 jobs running.', 429),
    );
    expect(
      (await post(owner.token, `/v1/connections/${id}/questions`, { question: 'Hi' }))
        .status,
    ).toBe(429);

    expect((await usageNow(owner.token)).body.questions).toEqual({ used: 0, limit: 3 });
    expect((await usageNow(other.token)).body.questions).toEqual({ used: 0, limit: 3 });
  });

  it('limits sign-in and refresh per IP address', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 4; i += 1) {
      expect(
        (
          await request(server)
            .post('/v1/auth/dev/login')
            .send({ email: `u${i}@localhost` })
        ).status,
      ).toBe(200);
    }
    // The fifth request is a refresh without a cookie: limited by the same counter.
    expect((await request(server).post('/v1/auth/refresh')).status).toBe(401);
    const limited = await request(server)
      .post('/v1/auth/dev/login')
      .send({ email: 'u9@localhost' });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();
    expect((await request(server).post('/v1/auth/refresh')).status).toBe(429);
  });

  it('lets sign-in through when Redis fails, but not a submission', async () => {
    await app.close();
    const broken = {
      hit: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      },
    };
    app = await createHttpApp({
      env: ENV,
      controllers: [JobsController],
      providers: [
        ConnectionService,
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: { test: async () => ({ ok: true }) } },
        { provide: JobQueue, useValue: jobs },
        { provide: JobEvents, useValue: { subscribe: async () => () => undefined } },
        { provide: RateLimiter, useValue: broken },
      ],
    });
    const { token, userId } = await signedIn();
    expect(token).toBeTruthy();
    const id = await connection(userId);
    const submitted = await post(token, `/v1/connections/${id}/queries`, {
      sql: 'SELECT 1',
    });
    expect(submitted.status).toBe(500);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it('shows today’s usage against the limits', async () => {
    const { token, userId } = await signedIn();
    const id = await connection(userId);
    await post(token, `/v1/connections/${id}/questions`, {
      question: 'How many orders?',
    });
    await usage.add(userId, utcDay(), {
      questions: 1,
      rowsReturned: 12,
      inputTokens: 900,
      outputTokens: 60,
    });
    const response = await usageNow(token);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      day: utcDay(),
      plan: 'free',
      questions: { used: 1, limit: 3 },
      submissionsPerMinute: 4,
      finishedQuestions: 1,
      rowsReturned: 12,
      tokens: { input: 900, output: 60 },
    });
    expect((await request(app.getHttpServer()).get('/v1/usage')).status).toBe(401);
  });
});
