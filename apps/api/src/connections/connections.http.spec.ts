import {
  ADDRESS_RESOLVER,
  CONNECTION_REPOSITORY,
  SCHEMA_REPOSITORY,
  UserDatabaseProbe,
  type ProbeResult,
} from '@ayd/core';
import { MemoryConnectionRepository, MemorySchemaRepository } from '@ayd/core/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JobsController } from '../jobs/jobs.controller';
import { createHttpApp } from '../testing/http-app';
import { inlineJobProviders } from '../testing/inline-jobs';
import { ConnectionsController } from './connections.controller';

const PASSWORD = 'sample_ro_password';
const SAMPLE = {
  label: 'Sample',
  host: 'db.example',
  port: 5432,
  databaseName: 'sample',
  username: 'sample_ro',
  password: PASSWORD,
  sslMode: 'require',
};

describe('connection routes', () => {
  let app: INestApplication;
  const connections = new MemoryConnectionRepository();
  let probeResult: ProbeResult;
  const probe = { test: jest.fn(async () => probeResult) };

  beforeEach(async () => {
    connections.rows.length = 0;
    connections.audits.length = 0;
    probeResult = { ok: true };
    probe.test.mockClear();
    app = await createHttpApp({
      controllers: [ConnectionsController, JobsController],
      providers: [
        ...inlineJobProviders(),
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: SCHEMA_REPOSITORY, useValue: new MemorySchemaRepository() },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: probe },
      ],
      requestId: 'req-conn-01',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function signedIn(email = 'dev@localhost') {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email, name: 'Dev' });
    return login.body.accessToken as string;
  }

  function job(token: string, id: string) {
    return request(app.getHttpServer())
      .get(`/v1/jobs/${id}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function create(token: string, body: object = SAMPLE) {
    const queued = await request(app.getHttpServer())
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    return queued;
  }

  it('requires a signed-in user', async () => {
    const response = await request(app.getHttpServer()).post('/v1/connections').send({});
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('queues the check, saves the connection once it passes, and never returns the password', async () => {
    const token = await signedIn();
    const queued = await create(token);
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ kind: 'connection.create', state: 'queued' });
    expect(JSON.stringify(queued.body)).not.toContain(PASSWORD);

    const done = await job(token, queued.body.id);
    expect(done.body).toMatchObject({
      state: 'succeeded',
      result: { label: 'Sample', host: 'db.example', status: 'active' },
    });
    expect(JSON.stringify(done.body)).not.toContain(PASSWORD);
    expect(probe.test).toHaveBeenCalledWith(
      expect.objectContaining({ hostIp: '1.1.1.1', username: 'sample_ro' }),
    );

    const listed = await request(app.getHttpServer())
      .get('/v1/connections')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.body).toHaveLength(1);
  });

  it('stores nothing when the login can write, and the job says why', async () => {
    probeResult = {
      ok: false,
      code: 'NOT_READ_ONLY',
      message: 'This role can change data.',
    };
    const token = await signedIn();
    const queued = await create(token);
    const done = await job(token, queued.body.id);
    expect(done.body).toMatchObject({
      state: 'failed',
      error: { code: 'NOT_READ_ONLY', message: 'This role can change data.' },
    });
    expect(connections.rows).toHaveLength(0);
  });

  it('rejects bad input at once, before queueing anything', async () => {
    const token = await signedIn();
    const plaintext = await create(token, { ...SAMPLE, sslMode: 'disable' });
    expect(plaintext.status).toBe(400);
    expect(plaintext.body.error.code).toBe('SSL_REQUIRED');
    const missing = await create(token, { ...SAMPLE, host: '' });
    expect(missing.status).toBe(400);
    expect(probe.test).not.toHaveBeenCalled();
  });

  async function saved(token: string): Promise<string> {
    const queued = await create(token);
    return (await job(token, queued.body.id)).body.result.id;
  }

  it('saves a rename at once (200) and checks a new host first (202)', async () => {
    const token = await signedIn();
    const id = await saved(token);
    probe.test.mockClear();

    const renamed = await request(app.getHttpServer())
      .patch(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ id, label: 'Renamed' });
    expect(probe.test).not.toHaveBeenCalled();

    const moved = await request(app.getHttpServer())
      .patch(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ host: 'other.example' });
    expect(moved.status).toBe(202);
    expect(moved.body).toMatchObject({ kind: 'connection.update', state: 'queued' });
    expect((await job(token, moved.body.id)).body).toMatchObject({
      state: 'succeeded',
      result: { id, host: 'other.example', label: 'Renamed' },
    });
  });

  it('keeps the old settings when a changed login fails its check', async () => {
    const token = await signedIn();
    const id = await saved(token);
    probeResult = {
      ok: false,
      code: 'CONNECTION_FAILED',
      message: 'Check the username and password.',
    };
    const moved = await request(app.getHttpServer())
      .patch(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrong' });
    expect((await job(token, moved.body.id)).body).toMatchObject({
      state: 'failed',
      error: { code: 'CONNECTION_FAILED' },
    });
    const current = await request(app.getHttpServer())
      .get(`/v1/connections/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(current.body).toMatchObject({ status: 'active' });
  });

  it('queues a test for the owner, and answers 404 to anyone else', async () => {
    const token = await signedIn();
    const id = await saved(token);
    const tested = await request(app.getHttpServer())
      .post(`/v1/connections/${id}/test`)
      .set('Authorization', `Bearer ${token}`);
    expect(tested.status).toBe(202);
    expect((await job(token, tested.body.id)).body).toMatchObject({
      kind: 'connection.test',
      state: 'succeeded',
      result: { id, status: 'active' },
    });

    const other = await signedIn('other@example.test');
    const theirs = await request(app.getHttpServer())
      .post(`/v1/connections/${id}/test`)
      .set('Authorization', `Bearer ${other}`);
    expect(theirs.status).toBe(404);
  });
});
