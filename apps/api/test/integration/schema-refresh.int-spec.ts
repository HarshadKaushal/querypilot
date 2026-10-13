import { randomUUID } from 'node:crypto';
import type { Logger } from 'nestjs-pino';
import { loadEnv } from '../../src/config/env';
import { ConnectionService } from '../../src/connections/connection.service';
import { PrismaConnectionRepository } from '../../src/connections/prisma-connection.repository';
import { PrismaService, UserDatabaseProbe } from '@ayd/core';
import { PrismaSchemaRepository } from '../../src/schema/prisma-schema.repository';
import { SchemaService } from '../../src/schema/schema.service';
import {
  createScratchDatabase,
  plainClients,
  type ScratchDatabase,
} from '../helpers/scratch-database';

// Phase 3 acceptance, end to end: real services, the application database through Prisma,
// and a multi-schema scratch database as the user's database. SSL is off because the
// application Postgres has no TLS.

describe('schema refresh end to end', () => {
  const env = loadEnv();
  const prisma = new PrismaService(env);
  const probe = new UserDatabaseProbe(
    { warn: () => undefined } as unknown as Logger,
    plainClients,
  );
  const connections = new ConnectionService(
    new PrismaConnectionRepository(prisma),
    { lookup: async () => ['127.0.0.1'] },
    probe,
    env,
  );
  const schemas = new SchemaService(
    new PrismaSchemaRepository(prisma),
    connections,
    probe,
  );
  const userId = randomUUID();
  const otherUserId = randomUUID();
  let db: ScratchDatabase;
  let reader: string;
  let connectionId: string;

  beforeAll(async () => {
    db = await createScratchDatabase();
    const login = await db.createLogin('app_reader');
    reader = login.username;
    await db.admin.query(`
      CREATE TABLE public.customers (id int PRIMARY KEY, name text, email text);
      CREATE TABLE public.orders (
        id int PRIMARY KEY, customer_id int REFERENCES public.customers (id), total numeric
      );
      CREATE TABLE public.old_notes (id int);
      CREATE SCHEMA sales;
      CREATE TABLE sales.targets (region text PRIMARY KEY, goal numeric);
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${reader};
      GRANT USAGE ON SCHEMA sales TO ${reader};
      GRANT SELECT ON ALL TABLES IN SCHEMA sales TO ${reader};
    `);
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          googleSubject: `test:${id}`,
          email: `${id}@example.test`,
          name: 'Schema refresh test',
          lastLoginAt: new Date(),
        },
      });
    }
    const created = await connections.create(
      userId,
      {
        label: 'Scratch',
        host: 'scratch.example',
        port: db.port,
        databaseName: db.name,
        username: login.username,
        password: login.password,
        sslMode: 'require',
      },
      null,
    );
    connectionId = created.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
    await db.drop();
  });

  it('stores version 1 with the default allowlist across schemas', async () => {
    const summary = await schemas.refresh(userId, connectionId, null);
    expect(summary).toMatchObject({ version: 1, tableCount: 4, defaultsApplied: true });

    const schema = await schemas.schema(userId, connectionId);
    expect(schema.tables.map((table) => `${table.schema}.${table.name}`)).toEqual([
      'public.customers',
      'public.old_notes',
      'public.orders',
      'sales.targets',
    ]);
    const customers = schema.tables[0]!;
    expect(customers.columns.map((column) => column.name)).toEqual(['id', 'name']);
    expect(JSON.stringify(schema)).not.toContain('email');
    expect(schema.tables[2]?.foreignKeys).toHaveLength(1);
  });

  it('creates a new version on refresh and keeps new objects hidden', async () => {
    const before = await schemas.schema(userId, connectionId);
    await db.admin.query(`
      ALTER TABLE public.orders ADD COLUMN discount numeric;
      CREATE TABLE sales.forecasts (region text, amount numeric);
      GRANT SELECT ON sales.forecasts TO ${reader};
      DROP TABLE public.old_notes;
    `);
    const summary = await schemas.refresh(userId, connectionId, null);
    expect(summary).toMatchObject({
      version: 2,
      defaultsApplied: false,
      newObjects: { tables: ['sales.forecasts'], columns: ['public.orders.discount'] },
    });

    const schema = await schemas.schema(userId, connectionId);
    expect(schema.version).toBe(2);
    expect(schema.fingerprint).not.toBe(before.fingerprint);
    const text = JSON.stringify(schema);
    expect(text).not.toContain('discount');
    expect(text).not.toContain('forecasts');

    const allowlist = await schemas.allowlist(userId, connectionId);
    const forecasts = allowlist.tables.find((table) => table.name === 'forecasts');
    expect(forecasts?.allowed).toBe(false);

    // The dropped table's allowlist rows went with the refresh.
    expect(
      await prisma.allowedObject.count({
        where: { connectionId, tableName: 'old_notes' },
      }),
    ).toBe(0);
  });

  it('gives concurrent refreshes different versions and keeps the newest five', async () => {
    const results = await Promise.all([
      schemas.refresh(userId, connectionId, null),
      schemas.refresh(userId, connectionId, null),
    ]);
    expect(results.map((result) => result.version).sort()).toEqual([3, 4]);
    for (let i = 0; i < 3; i++) {
      await schemas.refresh(userId, connectionId, null);
    }
    const versions = await prisma.schemaSnapshot.findMany({
      where: { connectionId },
      select: { version: true },
      orderBy: { version: 'asc' },
    });
    expect(versions.map((row) => row.version)).toEqual([3, 4, 5, 6, 7]);
  });

  it('saves allowlist edits and keeps them through the next refresh', async () => {
    const { version } = await schemas.schema(userId, connectionId);
    await schemas.updateAllowlist(
      userId,
      connectionId,
      {
        version,
        tables: [
          {
            schema: 'public',
            name: 'orders',
            description: 'One row per order',
            columns: [
              { name: 'id' },
              { name: 'discount', description: 'Discount in dollars' },
            ],
          },
        ],
      },
      null,
    );
    await schemas.refresh(userId, connectionId, null);

    const schema = await schemas.schema(userId, connectionId);
    expect(schema.version).toBe(version + 1);
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0]).toMatchObject({
      name: 'orders',
      description: 'One row per order',
      columns: [
        { name: 'id', description: null },
        { name: 'discount', description: 'Discount in dollars' },
      ],
    });
  });

  it("does not show one user's schema to another", async () => {
    await expect(schemas.schema(otherUserId, connectionId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(schemas.refresh(otherUserId, connectionId, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('writes an audit row for each refresh without the password', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { userId, eventType: 'schema.refreshed' },
    });
    expect(audits.length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(audits)).not.toContain('password');
  });

  it('refuses a snapshot read from a database the connection no longer points at', async () => {
    const before = await prisma.schemaSnapshot.count({ where: { connectionId } });
    const outcome = await new PrismaSchemaRepository(prisma).commitSnapshot(userId, {
      connectionId,
      database: { host: 'scratch.example', port: db.port, databaseName: 'some_other_db' },
      document: { formatVersion: 1, tables: [] },
      tableCount: 0,
      columnCount: 0,
      nextAllowlist: () => [],
    });
    expect(outcome).toEqual({ status: 'stale' });
    expect(await prisma.schemaSnapshot.count({ where: { connectionId } })).toBe(before);
  });

  it('deletes the snapshots and allowlist when the connection moves to another database', async () => {
    const other = await createScratchDatabase();
    try {
      expect(
        await prisma.allowedObject.count({ where: { connectionId } }),
      ).toBeGreaterThan(0);
      await connections.update(userId, connectionId, { databaseName: other.name }, null);
      expect(await prisma.schemaSnapshot.count({ where: { connectionId } })).toBe(0);
      expect(await prisma.allowedObject.count({ where: { connectionId } })).toBe(0);
      await expect(schemas.schema(userId, connectionId)).rejects.toMatchObject({
        code: 'SCHEMA_NOT_READY',
      });
      // The next refresh starts over, like a new connection.
      await expect(schemas.refresh(userId, connectionId, null)).resolves.toMatchObject({
        version: 1,
        defaultsApplied: true,
        tableCount: 0,
      });
    } finally {
      await other.drop();
    }
  });
});
