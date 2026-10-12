import { loadEnv } from '../config/env';
import { MetaController } from './meta.controller';

const env = loadEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
  CRYPTO_MASTER_KEYS: '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  CRYPTO_MASTER_KEY_VERSION: '1',
  EGRESS_IP: '192.0.2.10',
});

describe('MetaController', () => {
  it('returns the egress IP and SQL that passes the read-only probe', () => {
    const body = new MetaController(env).egress();
    expect(body.egressIp).toBe('192.0.2.10');
    expect(body.setupSql).toContain(
      'GRANT SELECT ON ALL TABLES IN SCHEMA public TO ayd_ro;',
    );
    // Without this, PostgreSQL 14 and earlier leave CREATE on public to every role, and the
    // probe rejects the role this SQL creates.
    expect(body.setupSql).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
    expect(body.setupSql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)/);
  });
});
