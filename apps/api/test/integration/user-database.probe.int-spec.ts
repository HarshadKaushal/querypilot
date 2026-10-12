import { Client, type ClientConfig } from 'pg';
import type { Logger } from 'nestjs-pino';
import {
  UserDatabaseProbe,
  type ProbeRequest,
} from '../../src/executor/user-database.probe';
import { createScratchDatabase, type ScratchDatabase } from '../helpers/scratch-database';

// The application Postgres in Compose and CI has no TLS, so these tests drop the SSL
// option. They prove the privilege queries against real PostgreSQL rules, which a fake
// client cannot.
const plainClients = (config: ClientConfig) => new Client({ ...config, ssl: false });

describe('read-only probe against PostgreSQL', () => {
  const probe = new UserDatabaseProbe(
    { warn: () => undefined } as unknown as Logger,
    plainClients,
  );
  let db: ScratchDatabase;

  beforeAll(async () => {
    db = await createScratchDatabase();
    await db.admin.query(
      'CREATE TABLE public.orders (id int PRIMARY KEY, total numeric NOT NULL)',
    );
  });

  afterAll(async () => {
    await db.drop();
  });

  function request(
    login: { username: string; password: string },
    database = db.name,
  ): ProbeRequest {
    return {
      hostIp: db.host,
      port: db.port,
      database,
      username: login.username,
      password: login.password,
      sslMode: 'require',
      servername: db.host,
    };
  }

  async function readOnlyLogin(prefix: string) {
    const login = await db.createLogin(prefix);
    await db.admin.query(`GRANT SELECT ON public.orders TO ${login.username}`);
    return login;
  }

  it('accepts a login that can only SELECT', async () => {
    const login = await readOnlyLogin('ro');
    await expect(probe.test(request(login))).resolves.toEqual({ ok: true });
  });

  it('rejects INSERT inherited from a group role', async () => {
    const login = await readOnlyLogin('member');
    const writers = await db.createGroup('writers');
    await db.admin.query(`GRANT INSERT ON public.orders TO ${writers}`);
    await db.admin.query(`GRANT ${writers} TO ${login.username}`);
    await expect(probe.test(request(login))).resolves.toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
      message: expect.stringContaining('can change data'),
    });
  });

  it('rejects INSERT granted to PUBLIC', async () => {
    const login = await readOnlyLogin('public_insert');
    await db.admin.query('GRANT INSERT ON public.orders TO PUBLIC');
    try {
      await expect(probe.test(request(login))).resolves.toMatchObject({
        ok: false,
        code: 'NOT_READ_ONLY',
      });
    } finally {
      await db.admin.query('REVOKE INSERT ON public.orders FROM PUBLIC');
    }
  });

  it('rejects an UPDATE grant on a single column', async () => {
    const login = await readOnlyLogin('column');
    await db.admin.query(`GRANT UPDATE (total) ON public.orders TO ${login.username}`);
    await expect(probe.test(request(login))).resolves.toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
    });
  });

  it('rejects a member of the role that owns a table', async () => {
    const login = await readOnlyLogin('owner_member');
    const owners = await db.createGroup('owners');
    await db.admin.query(`CREATE TABLE public.owned_${owners} (id int)`);
    await db.admin.query(`ALTER TABLE public.owned_${owners} OWNER TO ${owners}`);
    // The owner gives up its table privileges but can still ALTER or DROP the table, and
    // can grant the privileges back. Only the ownership check sees this.
    await db.admin.query(`REVOKE ALL ON public.owned_${owners} FROM ${owners}`);
    await db.admin.query(`GRANT ${owners} TO ${login.username}`);
    try {
      await expect(probe.test(request(login))).resolves.toMatchObject({
        ok: false,
        code: 'NOT_READ_ONLY',
        message: expect.stringContaining('owns tables'),
      });
    } finally {
      await db.admin.query(`DROP TABLE public.owned_${owners}`);
    }
  });

  it('explains CREATE on the public schema granted to PUBLIC', async () => {
    const login = await readOnlyLogin('public_create');
    await db.admin.query('GRANT CREATE ON SCHEMA public TO PUBLIC');
    try {
      await expect(probe.test(request(login))).resolves.toMatchObject({
        ok: false,
        code: 'NOT_READ_ONLY',
        message: expect.stringContaining('REVOKE CREATE ON SCHEMA public FROM PUBLIC'),
      });
    } finally {
      await db.admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    }
  });

  it('rejects CREATE granted to the login on another schema', async () => {
    const login = await readOnlyLogin('schema_create');
    await db.admin.query(`CREATE SCHEMA reporting_${login.username}`);
    await db.admin.query(
      `GRANT CREATE ON SCHEMA reporting_${login.username} TO ${login.username}`,
    );
    await expect(probe.test(request(login))).resolves.toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
      message: expect.stringContaining('This role can create objects'),
    });
  });

  it('rejects CREATE on the database', async () => {
    const login = await readOnlyLogin('db_create');
    await db.admin.query(`GRANT CREATE ON DATABASE ${db.name} TO ${login.username}`);
    await expect(probe.test(request(login))).resolves.toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
      message: expect.stringContaining('create schemas'),
    });
  });

  it('rejects a login that can SET ROLE to a superuser', async () => {
    const login = await readOnlyLogin('super_member');
    const admins = await db.createGroup('admins');
    await db.admin.query(`ALTER ROLE ${admins} SUPERUSER`);
    await db.admin.query(`GRANT ${admins} TO ${login.username}`);
    await expect(probe.test(request(login))).resolves.toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
      message: expect.stringContaining('SET ROLE'),
    });
  });

  it('rejects write access that is only reachable with SET ROLE', async () => {
    const login = await readOnlyLogin('noinherit');
    const writers = await db.createGroup('set_writers');
    await db.admin.query(`GRANT INSERT ON public.orders TO ${writers}`);
    // NOINHERIT: the login holds none of the group's privileges until it runs SET ROLE.
    await db.admin.query(`ALTER ROLE ${login.username} NOINHERIT`);
    await db.admin.query(`GRANT ${writers} TO ${login.username}`);
    await expect(probe.test(request(login))).resolves.toMatchObject({
      ok: false,
      code: 'NOT_READ_ONLY',
      message: expect.stringContaining('can change data'),
    });
  });

  it('reports a wrong password as a login problem', async () => {
    const login = await readOnlyLogin('wrong_password');
    await expect(
      probe.test(request({ ...login, password: 'not-the-password' })),
    ).resolves.toMatchObject({
      ok: false,
      code: 'CONNECTION_FAILED',
      message: expect.stringContaining('username and password'),
    });
  });

  it('reports a database name that does not exist', async () => {
    const login = await readOnlyLogin('missing_db');
    await expect(probe.test(request(login, `${db.name}_missing`))).resolves.toMatchObject(
      {
        ok: false,
        code: 'CONNECTION_FAILED',
        message: expect.stringContaining('does not exist'),
      },
    );
  });
});
