import { Inject, Injectable, Optional } from '@nestjs/common';
import { Client, type ClientConfig } from 'pg';
import { Logger } from 'nestjs-pino';
import { safeErrorDetail } from '../common/logging/safe-error';

export const PG_CLIENT_FACTORY = Symbol('PG_CLIENT_FACTORY');

export interface PgClientLike {
  connect(): Promise<unknown>;
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<unknown>;
}

export type PgClientFactory = (config: ClientConfig) => PgClientLike;

export type SslMode = 'require' | 'verify-full';

export interface ProbeRequest {
  hostIp: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  servername: string;
}

export type ProbeFailureCode = 'NOT_READ_ONLY' | 'SSL_REQUIRED' | 'CONNECTION_FAILED';

export type ProbeResult =
  { ok: true } | { ok: false; code: ProbeFailureCode; message: string };

const WRITE_PRIVILEGES = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
];

@Injectable()
export class UserDatabaseProbe {
  constructor(
    private readonly logger: Logger,
    @Optional() @Inject(PG_CLIENT_FACTORY) private readonly clients?: PgClientFactory,
  ) {}

  async test(request: ProbeRequest): Promise<ProbeResult> {
    const factory = this.clients ?? ((config: ClientConfig) => new Client(config));
    const client = factory({
      host: request.hostIp,
      port: request.port,
      database: request.database,
      user: request.username,
      password: request.password,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      ssl:
        request.sslMode === 'verify-full'
          ? { rejectUnauthorized: true, servername: request.servername }
          : { rejectUnauthorized: false, servername: request.servername },
    });
    try {
      await client.connect();
      return await this.verifyReadOnly(client);
    } catch (error) {
      this.logger.warn(safeErrorDetail(error), 'user database probe failed');
      if (error instanceof Error && /ssl/i.test(error.message)) {
        return {
          ok: false,
          code: 'SSL_REQUIRED',
          message:
            'The database did not accept an SSL connection. Enable SSL and try again.',
        };
      }
      return {
        ok: false,
        code: 'CONNECTION_FAILED',
        message: 'The database connection could not be completed.',
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async verifyReadOnly(client: PgClientLike): Promise<ProbeResult> {
    const role = await client.query(
      'SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
    );
    const current = role.rows[0];
    if (!current) {
      return {
        ok: false,
        code: 'CONNECTION_FAILED',
        message: 'The database role could not be read.',
      };
    }
    if (
      current.rolsuper === true ||
      current.rolcreatedb === true ||
      current.rolcreaterole === true
    ) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role is a superuser or can create databases or roles. Create a dedicated login with only SELECT and connect with that role.',
      };
    }

    const writes = await client.query(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = current_user
         AND privilege_type = ANY($1::text[])
       LIMIT 1`,
      [WRITE_PRIVILEGES],
    );
    if (writes.rows.length > 0) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role can change data. Revoke INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER, and grant only SELECT.',
      };
    }

    const owned = await client.query(
      `SELECT count(*)::int AS owned
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
    );
    if (Number(owned.rows[0]?.owned ?? 0) > 0) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role owns tables or views, so it can change them. Connect with a different role that has only SELECT.',
      };
    }

    const createSchema = await client.query(
      `SELECT nspname
       FROM pg_namespace
       WHERE has_schema_privilege(current_user, oid, 'CREATE')
         AND nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       LIMIT 1`,
    );
    if (createSchema.rows.length > 0) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role can create objects in a schema. Revoke CREATE and grant only SELECT before connecting.',
      };
    }

    return { ok: true };
  }
}
