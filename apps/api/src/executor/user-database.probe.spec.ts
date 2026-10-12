import type { ClientConfig } from 'pg';
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

// The first query lists every role the login can act as; this marks it in the fake.
const ROLES_QUERY = 'AS is_login';
const LOGIN = {
  is_login: true,
  rolsuper: false,
  rolcreatedb: false,
  rolcreaterole: false,
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
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN] };
      }
      return { rows: [] };
    }).test(request);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a superuser with a helpful message', async () => {
    const result = await probe(() => ({ rows: [{ ...LOGIN, rolsuper: true }] })).test(
      request,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_READ_ONLY');
      expect(result.message).toContain('superuser');
      expect(result.message).not.toContain(request.password);
    }
  });

  it('rejects a login that can SET ROLE to a superuser', async () => {
    const result = await probe((sql) => {
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN, { ...LOGIN, is_login: false, rolsuper: true }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result).toMatchObject({ ok: false, code: 'NOT_READ_ONLY' });
    if (!result.ok) {
      expect(result.message).toContain('SET ROLE');
    }
  });

  it('asks about every role the login can act as', async () => {
    const seen: string[] = [];
    await probe((sql) => {
      seen.push(sql);
      return sql.includes(ROLES_QUERY) ? { rows: [LOGIN] } : { rows: [] };
    }).test(request);
    // Every privilege query is scoped to MEMBER roles, which include SET ROLE targets.
    expect(seen).toHaveLength(5);
    for (const sql of seen) {
      expect(sql).toContain("'MEMBER'");
    }
  });

  it('rejects a role that can insert', async () => {
    const result = await probe((sql) => {
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN] };
      }
      if (sql.includes('has_table_privilege')) {
        return { rows: [{ '?column?': 1 }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('SELECT');
    }
  });

  it('checks write grants with inheritance-aware functions', async () => {
    const seen: string[] = [];
    await probe((sql) => {
      seen.push(sql);
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN] };
      }
      return { rows: [] };
    }).test(request);
    const all = seen.join('\n');
    expect(all).toContain('has_table_privilege');
    expect(all).toContain('has_any_column_privilege');
    expect(all).toContain('pg_has_role(c.relowner');
    expect(all).not.toContain('role_table_grants');
  });

  it('explains how to fix CREATE granted to PUBLIC on the public schema', async () => {
    const result = await probe((sql) => {
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN] };
      }
      if (sql.includes('has_schema_privilege')) {
        return { rows: [{ nspname: 'public', via_public: true }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result).toMatchObject({ ok: false, code: 'NOT_READ_ONLY' });
    if (!result.ok) {
      expect(result.message).toContain('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    }
  });

  it('keeps the plain CREATE message when the grant is to this role', async () => {
    const result = await probe((sql) => {
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN] };
      }
      if (sql.includes('has_schema_privilege')) {
        return { rows: [{ nspname: 'reporting', via_public: false }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result).toMatchObject({ ok: false, code: 'NOT_READ_ONLY' });
    if (!result.ok) {
      expect(result.message).toContain('This role can create objects');
      expect(result.message).not.toContain('PUBLIC');
    }
  });

  it('rejects a role that can create schemas in the database', async () => {
    const result = await probe((sql) => {
      if (sql.includes(ROLES_QUERY)) {
        return { rows: [LOGIN] };
      }
      if (sql.includes('has_database_privilege')) {
        return { rows: [{ '?column?': 1 }] };
      }
      return { rows: [] };
    }).test(request);
    expect(result).toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
      message: expect.stringContaining('CREATE on the database'),
    });
  });

  it('maps an SSL failure without returning the driver text', async () => {
    const client: PgClientLike = {
      connect: async () => {
        throw new Error('The server does not support SSL connections');
      },
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const logger = { warn: jest.fn() } as unknown as Logger;
    const result = await new UserDatabaseProbe(logger, () => client).test(request);
    expect(result).toMatchObject({ ok: false, code: 'SSL_REQUIRED' });
  });

  it('does not call a pg_hba.conf rejection an SSL problem or echo its text', async () => {
    const rejected = Object.assign(
      new Error(
        'no pg_hba.conf entry for host "192.0.2.10", user "sample_ro", database "secret_db", SSL encryption',
      ),
      { code: '28000' },
    );
    const client: PgClientLike = {
      connect: async () => {
        throw rejected;
      },
      query: async () => ({ rows: [] }),
      end: async () => undefined,
    };
    const logger = { warn: jest.fn() } as unknown as Logger;
    const result = await new UserDatabaseProbe(logger, () => client).test(request);
    expect(result).toMatchObject({ ok: false, code: 'CONNECTION_FAILED' });
    expect(JSON.stringify(result)).toContain('pg_hba.conf');
    expect(JSON.stringify(result)).not.toContain('secret_db');
  });

  describe('introspect', () => {
    it('stops before reading the schema when the login can write', async () => {
      const seen: string[] = [];
      const result = await probe((sql) => {
        seen.push(sql);
        if (sql.includes(ROLES_QUERY)) {
          return { rows: [LOGIN] };
        }
        return sql.includes('has_table_privilege')
          ? { rows: [{ '?column?': 1 }] }
          : { rows: [] };
      }).introspect(request);
      expect(result).toMatchObject({ ok: false, code: 'NOT_READ_ONLY' });
      expect(seen).not.toContain('BEGIN READ ONLY');
    });

    it('reads the schema inside a read-only transaction', async () => {
      const seen: string[] = [];
      const result = await probe((sql) => {
        seen.push(sql.trim());
        return sql.includes(ROLES_QUERY) ? { rows: [LOGIN] } : { rows: [] };
      }).introspect(request);
      expect(result).toEqual({ ok: true, document: { formatVersion: 1, tables: [] } });
      const begin = seen.indexOf('BEGIN READ ONLY');
      expect(begin).toBeGreaterThan(0);
      expect(seen[begin + 1]).toMatch(/^SET LOCAL statement_timeout/);
      expect(seen[seen.length - 1]).toBe('COMMIT');
    });

    it('returns SCHEMA_TOO_LARGE above the table limit', async () => {
      const result = await probe((sql) => {
        if (sql.includes(ROLES_QUERY)) {
          return { rows: [LOGIN] };
        }
        if (sql.includes("has_any_column_privilege(c.oid, 'SELECT')")) {
          return { rows: [{ oid: 1 }, { oid: 2 }, { oid: 3 }] };
        }
        return { rows: [] };
      }).introspect(request, { tables: 2, columns: 100 });
      expect(result).toMatchObject({ ok: false, code: 'SCHEMA_TOO_LARGE' });
    });
  });

  describe('TLS options', () => {
    async function configFor(servername: string, sslMode: ProbeRequest['sslMode']) {
      let seen: ClientConfig | undefined;
      const factory: PgClientFactory = (config) => {
        seen = config;
        return {
          connect: async () => undefined,
          query: async (sql) => ({ rows: sql.includes(ROLES_QUERY) ? [LOGIN] : [] }),
          end: async () => undefined,
        };
      };
      await new UserDatabaseProbe({ warn: jest.fn() } as unknown as Logger, factory).test(
        {
          ...request,
          servername,
          sslMode,
        },
      );
      return seen?.ssl;
    }

    it('sends the host name as the TLS server name', async () => {
      expect(await configFor('db.example.com', 'verify-full')).toEqual({
        rejectUnauthorized: true,
        servername: 'db.example.com',
      });
    });

    it('sends no server name when the user entered an IP address', async () => {
      expect(await configFor('203.0.113.7', 'verify-full')).toEqual({
        rejectUnauthorized: true,
      });
      expect(await configFor('2001:db8::7', 'require')).toEqual({
        rejectUnauthorized: false,
      });
    });
  });
});
