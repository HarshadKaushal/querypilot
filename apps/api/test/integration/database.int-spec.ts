import { randomUUID } from 'node:crypto';
import { User } from '@ayd/database';
import { openAppDatabase } from '../helpers/app-database';

describe('application database', () => {
  const db = openAppDatabase();
  const userId = randomUUID();

  afterAll(async () => {
    await User.destroy({ where: { id: userId } });
    await db.sequelize.close();
  });

  it('answers a query and has the auth tables', async () => {
    await db.ping();
    const users = await User.findAll({ limit: 1 });
    expect(Array.isArray(users)).toBe(true);
  });

  it('reads back the same instant it wrote, in any local time zone', async () => {
    // A TIMESTAMP column without a time zone would come back shifted by the machine's UTC
    // offset (5 h 30 min in India). Migration 20261016120000 made every column TIMESTAMPTZ.
    const instant = new Date('2026-01-15T23:45:12.345Z');
    await User.create({
      id: userId,
      googleSubject: `time-zone:${userId}`,
      email: 'tz@example.test',
      name: 'Time zone test',
      avatarUrl: null,
      lastLoginAt: instant,
    });
    const row = await User.findByPk(userId);
    expect(row?.lastLoginAt.toISOString()).toBe(instant.toISOString());
    const [raw] = await db.sequelize.query(
      `SELECT to_char(last_login_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS utc
       FROM users WHERE id = $1`,
      { bind: [userId] },
    );
    expect(raw).toEqual([{ utc: '2026-01-15T23:45:12.345' }]);
  });
});
