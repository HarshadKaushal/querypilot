import { HealthService } from './health.service';

describe('HealthService', () => {
  function service(database: () => Promise<void>, redis: () => Promise<void>) {
    return new HealthService(
      { ping: database } as never,
      { ping: redis } as never,
      { warn: jest.fn() } as never,
    );
  }

  it('reports ok when both dependencies answer', async () => {
    const report = await service(
      async () => undefined,
      async () => undefined,
    ).ready();
    expect(report.status).toBe('ok');
    expect(report.checks.appDatabase.status).toBe('up');
    expect(report.checks.redis.status).toBe('up');
  });

  it('reports degraded without leaking the dependency error', async () => {
    const report = await service(
      async () => {
        throw new Error('password=secret authentication failed');
      },
      async () => undefined,
    ).ready();
    expect(report.status).toBe('degraded');
    expect(report.checks.appDatabase.status).toBe('down');
    expect(JSON.stringify(report)).not.toContain('secret');
  });
});
