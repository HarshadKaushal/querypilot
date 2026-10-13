import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHttpApp } from '../testing/http-app';
import { testEnv } from '../testing/test-env';
import {
  ADDRESS_RESOLVER,
  CONNECTION_REPOSITORY,
  ConnectionService,
  SCHEMA_REPOSITORY,
  type SchemaDocument,
  SchemaService,
  SqlGuardService,
  UserDatabaseProbe,
} from '@ayd/core';
import { ConnectionsController } from '../connections/connections.controller';
import { MemoryConnectionRepository, MemorySchemaRepository } from '@ayd/core/testing';
import { SchemaController } from '../schema/schema.controller';
import { SqlGuardController } from './sql-guard.controller';

const document: SchemaDocument = {
  formatVersion: 1,
  tables: [
    {
      schema: 'public',
      name: 'customers',
      kind: 'table',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'text', nullable: false },
        { name: 'email', type: 'text', nullable: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
    {
      schema: 'public',
      name: 'orders',
      kind: 'table',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'customer_id', type: 'integer', nullable: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
  ],
};

describe('SQL check route', () => {
  let app: INestApplication;
  const connections = new MemoryConnectionRepository();
  const schemas = new MemorySchemaRepository();

  beforeEach(async () => {
    connections.rows.length = 0;
    schemas.snapshots.length = 0;
    schemas.allowed.clear();
    schemas.owners.clear();
    app = await createHttpApp({
      controllers: [ConnectionsController, SchemaController, SqlGuardController],
      providers: [
        ConnectionService,
        SchemaService,
        SqlGuardService,
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: SCHEMA_REPOSITORY, useValue: schemas },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        {
          provide: UserDatabaseProbe,
          useValue: {
            test: async () => ({ ok: true }),
            introspect: async () => ({ ok: true, document }),
          },
        },
      ],
      env: testEnv({ DEV_LOGIN_ENABLED: 'true', SQL_ROW_CAP: '50' }),
      requestId: 'req-sql-01',
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function connected(email = 'dev@localhost') {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email, name: 'Dev' });
    const token: string = login.body.accessToken;
    const created = await request(app.getHttpServer())
      .post('/v1/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Sample',
        host: 'db.example',
        port: 5432,
        databaseName: 'sample',
        username: 'sample_ro',
        password: 'sample_ro_password',
        sslMode: 'require',
      });
    const id: string = created.body.id;
    schemas.owners.set(id, login.body.user.id);
    return { token, id };
  }

  async function refresh(user: { token: string; id: string }) {
    await request(app.getHttpServer())
      .post(`/v1/connections/${user.id}/schema/refresh`)
      .set('Authorization', `Bearer ${user.token}`);
  }

  function check(user: { token: string; id: string }, body: unknown) {
    return request(app.getHttpServer())
      .post(`/v1/connections/${user.id}/sql/check`)
      .set('Authorization', `Bearer ${user.token}`)
      .send(body as object);
  }

  it('requires a signed-in user', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/connections/x/sql/check')
      .send({ sql: 'SELECT 1' });
    expect(response.status).toBe(401);
  });

  it('needs the schema to have been read first', async () => {
    const user = await connected();
    const response = await check(user, { sql: 'SELECT 1' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SCHEMA_NOT_READY');
  });

  it('returns the rewritten SQL for an allowed query, with the configured cap', async () => {
    const user = await connected();
    await refresh(user);
    const response = await check(user, { sql: 'SELECT * FROM customers' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      allowed: true,
      sql: 'SELECT customers.id, customers.name FROM public.customers LIMIT 51',
      limitApplied: true,
      rowCap: 50,
      schemaVersion: 1,
    });
  });

  it('rejects a hidden column with a reason, as a normal answer', async () => {
    const user = await connected();
    await refresh(user);
    const response = await check(user, { sql: 'SELECT email FROM customers' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      allowed: false,
      code: 'column_not_allowed',
      reason: 'The column public.customers.email is not on the allowlist.',
      schemaVersion: 1,
    });
  });

  it('follows allowlist edits', async () => {
    const user = await connected();
    await refresh(user);
    await request(app.getHttpServer())
      .put(`/v1/connections/${user.id}/allowlist`)
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        version: 1,
        tables: [{ schema: 'public', name: 'orders', columns: [{ name: 'id' }] }],
      });
    const response = await check(user, { sql: 'SELECT name FROM customers' });
    expect(response.body).toMatchObject({ allowed: false, code: 'table_not_allowed' });
  });

  it('requires the SQL as text', async () => {
    const user = await connected();
    await refresh(user);
    const response = await check(user, { sql: 42 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("returns not found for another user's connection", async () => {
    const owner = await connected('owner@localhost');
    await refresh(owner);
    const other = await connected('other@localhost');
    const response = await check(
      { token: other.token, id: owner.id },
      { sql: 'SELECT 1' },
    );
    expect(response.status).toBe(404);
  });
});
