import {
  ADDRESS_RESOLVER,
  CONNECTION_REPOSITORY,
  ConnectionService,
  JobQueue,
  notFound,
  QUERY_HISTORY,
  UserDatabaseProbe,
  type HistoryEntry,
} from '@ayd/core';
import { MemoryConnectionRepository } from '@ayd/core/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from '../testing/http-app';
import { HistoryController } from './history.controller';

function entry(fields: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 'h1',
    connectionId: 'c1',
    kind: 'question',
    question: 'How many orders?',
    sql: 'SELECT count(*) FROM public.orders LIMIT 1001',
    status: 'answered',
    errorCode: null,
    rowCount: 1,
    truncated: null,
    schemaVersion: 2,
    cached: false,
    summary: 'There are 12 orders.',
    models: ['gemini-3.8-flash'],
    inputTokens: 900,
    outputTokens: 60,
    llmMs: 800,
    queryMs: 9,
    totalMs: 1000,
    createdAt: '2026-10-14T10:00:00.000Z',
    finishedAt: '2026-10-14T10:00:01.000Z',
    ...fields,
  };
}

describe('history routes', () => {
  let app: INestApplication;
  let token = '';
  let userId = '';
  const connections = new MemoryConnectionRepository();
  const history = {
    list: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    deleteAll: jest.fn(),
    record: jest.fn(),
  };
  const jobs = { add: jest.fn() };

  beforeEach(async () => {
    connections.rows.length = 0;
    Object.values(history).forEach((fn) => fn.mockReset());
    jobs.add
      .mockReset()
      .mockResolvedValue({ id: 'j9', kind: 'query.run', state: 'queued' });
    app = await createHttpApp({
      controllers: [HistoryController],
      providers: [
        ConnectionService,
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: { test: async () => ({ ok: true }) } },
        { provide: QUERY_HISTORY, useValue: history },
        { provide: JobQueue, useValue: jobs },
      ],
      requestId: 'req-history-01',
    });
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email: 'dev@localhost', name: 'Dev' });
    token = login.body.accessToken;
    userId = login.body.user.id;
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);

  it('requires a signed-in user', async () => {
    expect((await request(app.getHttpServer()).get('/v1/history')).status).toBe(401);
  });

  it('lists the newest entries with a cursor, and clamps the page size', async () => {
    history.list.mockResolvedValue({ entries: [entry({})], nextCursor: 'abc' });
    const response = await get('/v1/history?limit=500&cursor=xyz');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ nextCursor: 'abc', entries: [{ id: 'h1' }] });
    expect(history.list).toHaveBeenCalledWith(userId, 50, 'xyz');
    await get('/v1/history?limit=abc');
    expect(history.list).toHaveBeenLastCalledWith(userId, 20, undefined);
  });

  it('shows one entry, and 404 for one that is not yours', async () => {
    history.get.mockResolvedValueOnce(entry({}));
    expect((await get('/v1/history/h1')).body.summary).toBe('There are 12 orders.');
    history.get.mockRejectedValueOnce(notFound());
    expect((await get('/v1/history/other')).status).toBe(404);
  });

  it('re-runs the stored SQL as a new job, without the model', async () => {
    const created = await connections.insert({
      id: 'c1',
      userId,
      label: 'Sample',
      host: 'db.example',
      port: 5432,
      databaseName: 'sample',
      sslMode: 'require',
      status: 'active',
      lastTestedAt: new Date(),
      sendSampleRowsToLlm: false,
      usernameCiphertext: 'u',
      usernameIv: 'u',
      usernameTag: 'u',
      passwordCiphertext: 'p',
      passwordIv: 'p',
      passwordTag: 'p',
      encryptedDataKey: 'k',
      dataKeyIv: 'k',
      dataKeyTag: 'k',
      keyVersion: 1,
    });
    history.get.mockResolvedValue(entry({ connectionId: created.id }));
    const response = await request(app.getHttpServer())
      .post('/v1/history/h1/rerun')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(202);
    expect(jobs.add).toHaveBeenCalledWith('query.run', {
      userId,
      connectionId: created.id,
      sql: 'SELECT count(*) FROM public.orders LIMIT 1001',
    });
  });

  it('answers 404 when there is no SQL to re-run', async () => {
    history.get.mockResolvedValue(entry({ status: 'ambiguous', sql: null }));
    const response = await request(app.getHttpServer())
      .post('/v1/history/h1/rerun')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(404);
    expect(jobs.add).not.toHaveBeenCalled();
  });

  it('deletes one entry (204, or 404 if missing) and all entries (204)', async () => {
    history.delete.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const del = (path: string) =>
      request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${token}`);
    expect((await del('/v1/history/h1')).status).toBe(204);
    expect((await del('/v1/history/h2')).status).toBe(404);
    history.deleteAll.mockResolvedValue(3);
    expect((await del('/v1/history')).status).toBe(204);
    expect(history.deleteAll).toHaveBeenCalledWith(userId);
  });
});
