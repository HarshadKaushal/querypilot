import { testEnv } from '../testing/test-env';
import { MetaController } from './meta.controller';

const env = testEnv({
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

  it('names the table owner for default privileges and covers other schemas', () => {
    const { setupSql } = new MetaController(env).egress();
    // Without FOR ROLE, only tables created by the role running the SQL become readable.
    expect(setupSql).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE <table_owner_role> IN SCHEMA public GRANT SELECT ON TABLES TO ayd_ro;',
    );
    expect(setupSql).toContain('--   GRANT USAGE ON SCHEMA <schema> TO ayd_ro;');
    expect(setupSql).toContain(
      '--   GRANT SELECT ON ALL TABLES IN SCHEMA <schema> TO ayd_ro;',
    );
  });
});
