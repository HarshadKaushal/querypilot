import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller';
import { AuthGuard } from '../auth/auth.guard';
import { AUTH_REPOSITORY } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { MemoryAuthRepository } from '../auth/memory-auth.repository';
import { GOOGLE_CLIENT } from '../auth/google.client';
import { TokenService } from '../auth/token.service';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { APP_ENV } from '../config/app-config.module';
import { loadEnv } from '../config/env';
import { UserDatabaseProbe } from '../executor/user-database.probe';
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
      controllers: [AuthController, ConnectionsController],
      providers: [
        AuthService,
        TokenService,
        AuthGuard,
        ConnectionService,
        { provide: APP_ENV, useValue: env },
        { provide: AUTH_REPOSITORY, useClass: MemoryAuthRepository },
        {
          provide: GOOGLE_CLIENT,
          useValue: { authorizationUrl: () => '', exchangeCode: async () => ({}) },
        },
        { provide: CONNECTION_REPOSITORY, useValue: connections },
        { provide: ADDRESS_RESOLVER, useValue: { lookup: async () => ['1.1.1.1'] } },
        { provide: UserDatabaseProbe, useValue: { test: async () => ({ ok: true }) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { id?: string }, _res: unknown, next: () => void) => {
      req.id = 'req-conn-01';
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
