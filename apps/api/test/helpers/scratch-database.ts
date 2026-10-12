import { randomBytes } from 'node:crypto';
import { Client, Pool, type ClientConfig, type PoolConfig } from 'pg';

// A throwaway database on the server behind DATABASE_URL, for tests that need real
// PostgreSQL privilege rules. The DATABASE_URL user must be able to create databases and
// roles (the Compose and CI users are superusers). Roles are cluster-wide, so every role
// gets the run suffix and is dropped in cleanup.

// The application Postgres in Compose and CI has no TLS, while the probe and the executor
// always ask for it. These factories turn SSL off for tests against that server only.
export const plainClients = (config: ClientConfig) =>
  new Client({ ...config, ssl: false });
export const plainPools = (config: PoolConfig) => new Pool({ ...config, ssl: false });

export interface ScratchDatabase {
  name: string;
  host: string;
  port: number;
  /** Connected to the scratch database as the DATABASE_URL user. */
  admin: Client;
  /** Creates a LOGIN role named <prefix>_<suffix> and returns its name and password. */
  createLogin(prefix: string): Promise<{ username: string; password: string }>;
  /** Creates a NOLOGIN role named <prefix>_<suffix>. */
  createGroup(prefix: string): Promise<string>;
  drop(): Promise<void>;
}

export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const suffix = randomBytes(4).toString('hex');
  const name = `ayd_scratch_${suffix}`;
  const base = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  const roles: string[] = [];

  const server = new Client({ ...base, database: url.pathname.slice(1) });
  await server.connect();
  await server.query(`CREATE DATABASE ${name}`);
  const admin = new Client({ ...base, database: name });
  await admin.connect();

  return {
    name,
    host: base.host,
    port: base.port,
    admin,
    async createLogin(prefix) {
      const username = `${prefix}_${suffix}`;
      const password = randomBytes(12).toString('hex');
      await admin.query(`CREATE ROLE ${username} LOGIN PASSWORD '${password}'`);
      roles.push(username);
      return { username, password };
    },
    async createGroup(prefix) {
      const role = `${prefix}_${suffix}`;
      await admin.query(`CREATE ROLE ${role} NOLOGIN`);
      roles.push(role);
      return role;
    },
    async drop() {
      await admin.end().catch(() => undefined);
      await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      for (const role of roles.reverse()) {
        await server.query(`DROP ROLE IF EXISTS ${role}`);
      }
      await server.end();
    },
  };
}
