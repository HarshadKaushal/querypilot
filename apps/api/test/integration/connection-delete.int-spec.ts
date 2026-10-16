import { randomUUID } from 'node:crypto';
import { SequelizeConnectionRepository } from '@ayd/core';
import { AuditLog, Connection, User } from '@ayd/database';
import { loadEnv } from '../../src/config/env';
import { openAppDatabase } from '../helpers/app-database';

// Deleting a connection and writing its audit row happen in one transaction, and only a
// real delete is audited: someone else's id, or two deletes at once, write no extra row.

describe('connection delete in PostgreSQL', () => {
  const db = openAppDatabase(loadEnv().DATABASE_URL);
  const repo = new SequelizeConnectionRepository(db);
  const owner = randomUUID();
  const other = randomUUID();

  function connection(id: string) {
    return Connection.create({
      id,
      userId: owner,
      label: 'Delete test',
      host: 'db.example',
      port: 5432,
      databaseName: 'x',
      sslMode: 'require',
      usernameCiphertext: 'u',
      usernameIv: 'u',
      usernameTag: 'u',
      passwordCiphertext: 'p',
      passwordIv: 'p',
      passwordTag: 'p',
      encryptedDataKey: 'k',
      dataKeyIv: 'k',
      dataKeyTag: 'k',
      keyVersion: 1,
      status: 'active',
    });
  }

  function audits(connectionId: string) {
    return AuditLog.findAll({
      where: { eventType: 'connection.deleted', metadata: { connectionId } },
    });
  }

  beforeAll(async () => {
    for (const id of [owner, other]) {
      await User.create({
        id,
        googleSubject: `test:${id}`,
        email: `${id}@example.test`,
        name: 'Delete test',
        lastLoginAt: new Date(),
      });
    }
  });

  afterAll(async () => {
    // An array in a where clause means IN (...).
    await AuditLog.destroy({ where: { userId: [owner, other] } });
    await User.destroy({ where: { id: [owner, other] } });
    await db.sequelize.close();
  });

  it('deletes and audits together, with the IP address', async () => {
    const id = randomUUID();
    await connection(id);
    expect(await repo.delete(owner, id, '203.0.113.7')).toBe(true);
    expect(await Connection.count({ where: { id } })).toBe(0);
    const rows = await audits(id);
    expect(rows.map((r) => [r.userId, r.ip])).toEqual([[owner, '203.0.113.7']]);
  });

  it("writes nothing for someone else's connection", async () => {
    const id = randomUUID();
    await connection(id);
    expect(await repo.delete(other, id, null)).toBe(false);
    expect(await Connection.count({ where: { id } })).toBe(1);
    expect(await audits(id)).toEqual([]);
  });

  it('writes one audit row when two deletes arrive at once', async () => {
    const id = randomUUID();
    await connection(id);
    const results = await Promise.all([
      repo.delete(owner, id, null),
      repo.delete(owner, id, null),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await audits(id)).toHaveLength(1);
  });
});
