import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  async function appWith(ready: HealthService['ready']): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: { live: () => ({ status: 'ok' }), ready },
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('answers liveness without checking dependencies', async () => {
    const app = await appWith(jest.fn());
    const response = await request(app.getHttpServer()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    await app.close();
  });

  it('returns 503 when a dependency is down', async () => {
    const app = await appWith(async () => ({
      status: 'degraded' as const,
      checks: {
        appDatabase: { status: 'down' as const, latencyMs: 4 },
        redis: { status: 'up' as const, latencyMs: 1 },
      },
    }));
    const response = await request(app.getHttpServer()).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.appDatabase.status).toBe('down');
    await app.close();
  });
});
