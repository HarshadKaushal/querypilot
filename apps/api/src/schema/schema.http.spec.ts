import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthGuard } from '../auth/auth.guard';
import { AUTH_REPOSITORY } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { GOOGLE_CLIENT } from '../auth/google.client';
import { MemoryAuthRepository } from '../auth/memory-auth.repository';
import { TokenService } from '../auth/token.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { APP_ENV } from '../config/app-config.module';
import { loadEnv } from '../config/env';
import { CONNECTION_REPOSITORY } from '../connections/connection.repository';
import { ADDRESS_RESOLVER, ConnectionService } from '../connections/connection.service';
import { ConnectionsController } from '../connections/connections.controller';
import { MemoryConnectionRepository } from '../connections/memory-connection.repository';
import {
  UserDatabaseProbe,
  type IntrospectResult,
} from '../executor/user-database.probe';
import { MemorySchemaRepository } from './memory-schema.repository';
import { SchemaController } from './schema.controller';
import type { SchemaDocument } from './schema-document';
import { SCHEMA_REPOSITORY } from './schema.repository';
import { SchemaService } from './schema.service';

const customers = {
  schema: 'public',
  name: 'customers',
  kind: 'table' as const,
  columns: [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'name', type: 'text', nullable: false },
    { name: 'email', type: 'text', nullable: false },
  ],
  primaryKey: ['id'],
  foreignKeys: [],
};

const firstDocument: SchemaDocument = { formatVersion: 1, tables: [customers] };

describe('schema routes', () => {
  let app: INestApplication;
  let introspection: IntrospectResult;
  const connections = new MemoryConnectionRepository();
  const schemas = new MemorySchemaRepository();

  beforeEach(async () => {
    connections.rows.length = 0;
    schemas.snapshots.length = 0;
    schemas.allowed.clear();
    schemas.owners.clear();
    introspection = { ok: true, document: firstDocument };
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
      DEV_LOGIN_ENABLED: 'true',
      CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      CRYPTO_MASTER_KEY_VERSION: '1',
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, ConnectionsController, SchemaController],
      providers: [
        AuthService,
        TokenService,
        AuthGuard,
        ConnectionService,
        SchemaService,
        { provide: APP_ENV, useValue: env },
        { provide: AUTH_REPOSITORY, useClass: MemoryAuthRepository },
        {
          provide: GOOGLE_CLIENT,
          useValue: { authorizationUrl: () => '', exchangeCode: async () => ({}) },
        },
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: SCHEMA_REPOSITORY, useValue: schemas },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        {
          provide: UserDatabaseProbe,
          useValue: {
            test: async () => ({ ok: true }),
            introspect: async () => introspection,
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { id?: string }, _res: unknown, next: () => void) => {
      req.id = 'req-schema-01';
      next();
    });
    app.useGlobalFilters(
      new AllExceptionsFilter({ error: jest.fn() } as unknown as Logger),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function signIn(email: string): Promise<{ token: string; userId: string }> {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/dev/login')
      .send({ email, name: 'Dev' });
    return { token: login.body.accessToken, userId: login.body.user.id };
  }

  async function connect(user: { token: string; userId: string }): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/v1/connections')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        label: 'Sample',
        host: 'db.example',
        port: 5432,
        databaseName: 'sample',
        username: 'sample_ro',
        password: 'sample_ro_password',
        sslMode: 'require',
      });
    schemas.owners.set(created.body.id, user.userId);
    return created.body.id;
  }

  function call(method: 'get' | 'post', path: string, token: string) {
    const server = request(app.getHttpServer());
    const pending = method === 'get' ? server.get(path) : server.post(path);
    return pending.set('Authorization', `Bearer ${token}`);
  }

  it('requires a signed-in user', async () => {
    const response = await request(app.getHttpServer()).get('/v1/connections/x/schema');
    expect(response.status).toBe(401);
  });

  it('says the schema is not ready before the first refresh', async () => {
    const user = await signIn('dev@localhost');
    const id = await connect(user);
    const response = await call('get', `/v1/connections/${id}/schema`, user.token);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SCHEMA_NOT_READY');
  });

  it('applies the default allowlist on the first refresh and hides sensitive columns', async () => {
    const user = await signIn('dev@localhost');
    const id = await connect(user);
    const refreshed = await call(
      'post',
      `/v1/connections/${id}/schema/refresh`,
      user.token,
    );
    expect(refreshed.status).toBe(201);
    expect(refreshed.body).toMatchObject({
      version: 1,
      tableCount: 1,
      columnCount: 3,
      defaultsApplied: true,
      newObjects: { tables: [], columns: [] },
    });

    const schema = await call('get', `/v1/connections/${id}/schema`, user.token);
    expect(schema.status).toBe(200);
    expect(schema.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(schema.body.tables[0].columns.map((c: { name: string }) => c.name)).toEqual([
      'id',
      'name',
    ]);
    expect(JSON.stringify(schema.body)).not.toContain('email');

    const allowlist = await call('get', `/v1/connections/${id}/allowlist`, user.token);
    const email = allowlist.body.tables[0].columns.find(
      (c: { name: string }) => c.name === 'email',
    );
    expect(email).toMatchObject({ allowed: false, sensitive: true });
  });

  it('keeps objects found by a later refresh hidden and reports them', async () => {
    const user = await signIn('dev@localhost');
    const id = await connect(user);
    await call('post', `/v1/connections/${id}/schema/refresh`, user.token);
    const before = await call('get', `/v1/connections/${id}/schema`, user.token);

    introspection = {
      ok: true,
      document: {
        formatVersion: 1,
        tables: [
          {
            ...customers,
            columns: [
              ...customers.columns,
              { name: 'segment', type: 'text', nullable: true },
            ],
          },
          {
            schema: 'sales',
            name: 'targets',
            kind: 'table',
            columns: [{ name: 'region', type: 'text', nullable: false }],
            primaryKey: ['region'],
            foreignKeys: [],
          },
        ],
      },
    };
    const refreshed = await call(
      'post',
      `/v1/connections/${id}/schema/refresh`,
      user.token,
    );
    expect(refreshed.body).toMatchObject({
      version: 2,
      defaultsApplied: false,
      newObjects: { tables: ['sales.targets'], columns: ['public.customers.segment'] },
    });

    const after = await call('get', `/v1/connections/${id}/schema`, user.token);
    expect(after.body.version).toBe(2);
    expect(after.body.fingerprint).not.toBe(before.body.fingerprint);
    expect(JSON.stringify(after.body)).not.toContain('segment');
    expect(JSON.stringify(after.body)).not.toContain('targets');
  });

  it("returns not found for another user's connection", async () => {
    const owner = await signIn('owner@localhost');
    const id = await connect(owner);
    const other = await signIn('other@localhost');
    for (const [method, path] of [
      ['post', `/v1/connections/${id}/schema/refresh`],
      ['get', `/v1/connections/${id}/schema`],
      ['get', `/v1/connections/${id}/allowlist`],
    ] as const) {
      const response = await call(method, path, other.token);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('marks the connection failing when the login can no longer only read', async () => {
    const user = await signIn('dev@localhost');
    const id = await connect(user);
    introspection = {
      ok: false,
      code: 'NOT_READ_ONLY',
      message: 'This role, or a role it belongs to, can change data.',
    };
    const response = await call(
      'post',
      `/v1/connections/${id}/schema/refresh`,
      user.token,
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('NOT_READ_ONLY');
    expect(connections.rows[0]?.status).toBe('failing');
    expect(schemas.snapshots).toHaveLength(0);
  });

  it('refuses a schema above the limits without marking the connection failing', async () => {
    const user = await signIn('dev@localhost');
    const id = await connect(user);
    introspection = { ok: false, code: 'SCHEMA_TOO_LARGE', message: 'Too many tables.' };
    const response = await call(
      'post',
      `/v1/connections/${id}/schema/refresh`,
      user.token,
    );
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('SCHEMA_TOO_LARGE');
    expect(connections.rows[0]?.status).toBe('active');
  });
});
