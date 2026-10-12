import { Inject, Injectable, Optional } from '@nestjs/common';
import { Client, type ClientConfig } from 'pg';
import { Logger } from 'nestjs-pino';
import { safeErrorDetail } from '../common/logging/safe-error';
import type { SchemaDocument } from '../schema/schema-document';
import { classifyConnectError, errorCode } from './connect-error';
import { userDatabaseConfig } from './connection-config';
import {
  DEFAULT_LIMITS,
  readSchema,
  type IntrospectionLimits,
} from './schema-introspection';

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

export type ProbeFailure = { ok: false; code: ProbeFailureCode; message: string };

export type ProbeResult = { ok: true } | ProbeFailure;

export type IntrospectResult =
  | { ok: true; document: SchemaDocument }
  | ProbeFailure
  | { ok: false; code: 'SCHEMA_TOO_LARGE'; message: string };

// Introspection reads more than the probe, so it gets a longer statement timeout.
const INTROSPECTION_TIMEOUT_MS = 15000;

@Injectable()
export class UserDatabaseProbe {
  constructor(
    private readonly logger: Logger,
    @Optional() @Inject(PG_CLIENT_FACTORY) private readonly clients?: PgClientFactory,
  ) {}

  async test(request: ProbeRequest): Promise<ProbeResult> {
    return this.withClient(request, (client) => this.verifyReadOnly(client));
  }

  // Checks the login is still read-only, since grants can change after the connection was
  // saved, then reads the schema inside a READ ONLY transaction.
  async introspect(
    request: ProbeRequest,
    limits: IntrospectionLimits = DEFAULT_LIMITS,
  ): Promise<IntrospectResult> {
    return this.withClient<IntrospectResult>(request, async (client) => {
      const readOnly = await this.verifyReadOnly(client);
      if (!readOnly.ok) {
        return readOnly;
      }
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${INTROSPECTION_TIMEOUT_MS}`);
      const outcome = await readSchema(client, limits);
      await client.query('COMMIT');
      if (!outcome.ok) {
        return {
          ok: false,
          code: 'SCHEMA_TOO_LARGE',
          message: `This login can read more than ${limits.tables} tables or ${limits.columns} columns. Grant SELECT only on the tables the assistant should use, then refresh.`,
        };
      }
      return outcome;
    });
  }

  private async withClient<T>(
    request: ProbeRequest,
    work: (client: PgClientLike) => Promise<T>,
  ): Promise<T | ProbeFailure> {
    const factory = this.clients ?? ((config: ClientConfig) => new Client(config));
    const client = factory({ ...userDatabaseConfig(request), statement_timeout: 5000 });
    try {
      await client.connect();
      return await work(client);
    } catch (error) {
      this.logger.warn(
        { ...safeErrorDetail(error), code: errorCode(error) },
        'user database probe failed',
      );
      return classifyConnectError(error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  // Every check covers each role the login can act as: itself, roles it inherits from, and
  // roles it can switch to with SET ROLE. pg_has_role(..., 'MEMBER') is true for all three.
  // Role attributes such as SUPERUSER are never inherited, so a login that can SET ROLE to a
  // superuser looks harmless unless those roles are checked too.
  private async verifyReadOnly(client: PgClientLike): Promise<ProbeResult> {
    const roles = await client.query(
      `SELECT r.rolname = current_user AS is_login, r.rolsuper, r.rolcreatedb, r.rolcreaterole
       FROM pg_roles r
       WHERE pg_has_role(current_user, r.oid, 'MEMBER')`,
    );
    const login = roles.rows.find((row) => row.is_login === true);
    if (!login) {
      return {
        ok: false,
        code: 'CONNECTION_FAILED',
        message: 'The database role could not be read.',
      };
    }
    if (isPowerful(login)) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role is a superuser or can create databases or roles. Create a dedicated login with only SELECT and connect with that role.',
      };
    }
    if (roles.rows.some(isPowerful)) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role is a member of a role that is a superuser or can create databases or roles, and can switch to it with SET ROLE. Remove that membership, or connect with a login that has only SELECT.',
      };
    }

    // has_table_privilege counts grants to the role itself and to PUBLIC. The column check
    // catches grants such as UPDATE (price) ON products.
    const writes = await client.query(
      `SELECT 1
       FROM pg_roles r
       CROSS JOIN pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE pg_has_role(current_user, r.oid, 'MEMBER')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND (
           has_table_privilege(r.oid, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           OR has_any_column_privilege(r.oid, c.oid, 'INSERT, UPDATE, REFERENCES')
         )
       LIMIT 1`,
    );
    if (writes.rows.length > 0) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role, or a role it belongs to, can change data. Revoke INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER, and grant only SELECT.',
      };
    }

    // A member of the owning role can alter or drop the table, so ownership through any role
    // the login belongs to counts.
    const owned = await client.query(
      `SELECT count(*)::int AS owned
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE pg_has_role(c.relowner, 'MEMBER')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND c.relkind IN ('r', 'p', 'v', 'm', 'f')`,
    );
    if (Number(owned.rows[0]?.owned ?? 0) > 0) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role, or a role it belongs to, owns tables or views, so it can change them. Connect with a different role that has only SELECT.',
      };
    }

    // PostgreSQL 14 and earlier grant CREATE on the public schema to PUBLIC by default, so
    // revoking CREATE from this role alone does not help. Say so when that is the cause.
    const createSchema = await client.query(
      `SELECT n.nspname, has_schema_privilege('public', n.oid, 'CREATE') AS via_public
       FROM pg_namespace n
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND EXISTS (
           SELECT 1 FROM pg_roles r
           WHERE pg_has_role(current_user, r.oid, 'MEMBER')
             AND has_schema_privilege(r.oid, n.oid, 'CREATE')
         )
       ORDER BY via_public DESC, n.nspname = 'public' DESC
       LIMIT 1`,
    );
    const creatable = createSchema.rows[0];
    if (creatable) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message: createMessage(
          creatable.nspname === 'public',
          creatable.via_public === true,
        ),
      };
    }

    // CREATE on the database lets a role add a schema of its own and create tables there.
    const createDatabase = await client.query(
      `SELECT 1
       FROM pg_roles r
       WHERE pg_has_role(current_user, r.oid, 'MEMBER')
         AND has_database_privilege(r.oid, current_database(), 'CREATE')
       LIMIT 1`,
    );
    if (createDatabase.rows.length > 0) {
      return {
        ok: false,
        code: 'NOT_READ_ONLY',
        message:
          'This role, or a role it belongs to, can create schemas in this database. Revoke CREATE on the database and grant only SELECT before connecting.',
      };
    }

    return { ok: true };
  }
}

function isPowerful(role: Record<string, unknown>): boolean {
  return (
    role.rolsuper === true || role.rolcreatedb === true || role.rolcreaterole === true
  );
}

function createMessage(publicSchema: boolean, viaPublic: boolean): string {
  if (publicSchema && viaPublic) {
    return 'Every role on this server can create objects in the public schema, the default on PostgreSQL 14 and earlier. Run REVOKE CREATE ON SCHEMA public FROM PUBLIC; then connect again. Grant CREATE back to any role that still needs it.';
  }
  if (viaPublic) {
    return 'Every role on this server can create objects in one of your schemas, because CREATE was granted to PUBLIC. Revoke CREATE on that schema from PUBLIC, then connect again.';
  }
  return 'This role can create objects in a schema. Revoke CREATE and grant only SELECT before connecting.';
}
