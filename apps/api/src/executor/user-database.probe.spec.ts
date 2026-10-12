import { Logger } from 'nestjs-pino';
import {
  UserDatabaseProbe,
  type PgClientFactory,
  type PgClientLike,
  type ProbeRequest,
} from './user-database.probe';

const request: ProbeRequest = {
  hostIp: '127.0.0.1',
  port: 5432,
  database: 'sample',
  username: 'sample_ro',
  password: 'sample_ro_password',
  sslMode: 'require',
  servername: 'localhost',
};

function probe(
  script: (sql: string) => { rows: Record<string, unknown>[] },
): UserDatabaseProbe {
  const client: PgClientLike = {
    connect: async () => undefined,
    query: async (sql) => script(sql),
    end: async () => undefined,
  };
  const factory: PgClientFactory = () => client;
  return new UserDatabaseProbe({ warn: jest.fn() } as unknown as Logger, factory);
}

describe('UserDatabaseProbe', () => {
  it('accepts a role that cannot write or own objects', async () => {
    const result = await probe((sql) => {
      if (sql.includes('pg_roles WHERE rolname')) {
        return { rows: [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a superuser with a helpful message', async () => {
    const result = await probe(() => ({
      rows: [{ rolsuper: true, rolcreatedb: false, rolcreaterole: false }],
    })).test(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_READ_ONLY');
      expect(result.message).toContain('superuser');
      expect(result.message).not.toContain(request.password);
    }
  });

  it('rejects a role that can insert', async () => {
    const result = await probe((sql) => {
      if (sql.includes('pg_roles WHERE rolname')) {
        return { rows: [{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }] };
      }
      if (sql.includes('role_table_grants')) {
        return { rows: [{ privilege_type: 'INSERT' }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('SELECT');
    }
  });

  it('maps an SSL failure without returning the driver text', async () => {
    const client: PgClientLike = {
      connect: async () => {
        throw new Error('ssl required: postgres://user:secret@db/sample');
      },
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const logger = { warn: jest.fn() } as unknown as Logger;
    const result = await new UserDatabaseProbe(logger, () => client).test(request);
    expect(result).toMatchObject({ ok: false, code: 'SSL_REQUIRED' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
