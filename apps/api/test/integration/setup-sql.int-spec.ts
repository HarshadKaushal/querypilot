import type { Logger } from 'nestjs-pino';
import { UserDatabaseProbe } from '../../src/executor/user-database.probe';
import { SETUP_SQL } from '../../src/meta/meta.controller';
import {
  createScratchDatabase,
  plainClients,
  type ScratchDatabase,
} from '../helpers/scratch-database';

// Runs the setup SQL from GET /v1/meta/egress the way a customer would, placeholders filled
// in, and checks the login it creates passes the read-only probe and can read what it
// should. The application Postgres has no TLS, so the probe's SSL is turned off.

describe('setup SQL shown to customers', () => {
  let db: ScratchDatabase;

  beforeAll(async () => {
    db = await createScratchDatabase();
  });

  afterAll(async () => {
    await db.drop();
  });

  it('creates a login that passes the probe and reads tables created later', async () => {
    // The helper creates (and later drops) the login, so the CREATE ROLE line is skipped.
    const login = await db.createLogin('setup_ro');
    const owner = await db.createGroup('app_owner');
    await db.admin.query(`
      GRANT CREATE ON SCHEMA public TO ${owner};
      CREATE SCHEMA reporting AUTHORIZATION ${owner};
      SET ROLE ${owner};
      CREATE TABLE public.orders (id int);
      CREATE TABLE reporting.monthly (id int);
      RESET ROLE;
    `);
    const filled = SETUP_SQL.split('\n')
      .filter((line) => !line.startsWith('CREATE ROLE'))
      // Turn on the commented example for a second schema.
      .map((line) => line.replace(/^-- {3}/, ''))
      .filter((line) => !line.startsWith('--'))
      .join('\n')
      .replaceAll('ayd_ro', login.username)
      .replaceAll('<database>', db.name)
      .replaceAll('<table_owner_role>', owner)
      .replaceAll('<schema>', 'reporting')
      .replaceAll('<that_role>', owner);
    await db.admin.query(filled);

    const probe = new UserDatabaseProbe(
      { warn: () => undefined } as unknown as Logger,
      plainClients,
    );
    await expect(
      probe.test({
        hostIp: db.host,
        port: db.port,
        database: db.name,
        username: login.username,
        password: login.password,
        sslMode: 'require',
        servername: db.host,
      }),
    ).resolves.toEqual({ ok: true });

    // A table the owner creates after the setup is readable without new grants.
    await db.admin.query(
      `SET ROLE ${owner}; CREATE TABLE public.created_later (id int); RESET ROLE;`,
    );
    const readable = await db.admin.query(
      `SELECT has_table_privilege($1, 'public.orders', 'SELECT') AS orders,
              has_table_privilege($1, 'reporting.monthly', 'SELECT') AS reporting,
              has_table_privilege($1, 'public.created_later', 'SELECT') AS later,
              has_table_privilege($1, 'public.orders', 'INSERT') AS can_insert`,
      [login.username],
    );
    expect(readable.rows[0]).toEqual({
      orders: true,
      reporting: true,
      later: true,
      can_insert: false,
    });
  });
});
