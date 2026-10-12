import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserDatabaseProbe } from '../executor/user-database.probe';
import { createHttpApp } from '../testing/http-app';
import { ADDRESS_RESOLVER, ConnectionService } from './connection.service';
import { CONNECTION_REPOSITORY } from './connection.repository';
import { ConnectionsController } from './connections.controller';
import { MemoryConnectionRepository } from './memory-connection.repository';

const PASSWORD = 'sample_ro_password';

describe('connection routes', () => {
  let app: INestApplication;
  const connections = new MemoryConnectionRepository();

  beforeEach(async () => {
    connections.rows.length = 0;
    connections.audits.length = 0;
    app = await createHttpApp({
      controllers: [ConnectionsController],
      providers: [
        ConnectionService,
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: { test: async () => ({ ok: true }) } },
      ],
      requestId: 'req-conn-01',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a signed-in user', async () => {
    const response = await request(app.getHttpServer()).post('/v1/connections').send({});
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a connection and omits the password from the response', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email: 'dev@localhost', name: 'Dev' });
    const created = await request(app.getHttpServer())
      .post('/v1/connections')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({
        label: 'Sample',
        host: 'db.example',
        port: 5432,
        databaseName: 'sample',
        username: 'sample_ro',
        password: PASSWORD,
        sslMode: 'require',
      });
    expect(created.status).toBe(201);
    expect(created.body.password).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toContain(PASSWORD);
    const listed = await request(app.getHttpServer())
      .get('/v1/connections')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(listed.body).toHaveLength(1);
  });
});
