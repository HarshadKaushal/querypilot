import { randomUUID } from 'node:crypto';
import { PrismaConnectionRepository, PrismaService } from '@ayd/core';
import { loadEnv } from '../../src/config/env';

// Deleting a connection and writing its audit row happen in one transaction, and only a
// real delete is audited: someone else's id, or two deletes at once, write no extra row.

describe('connection delete in PostgreSQL', () => {
  const prisma = new PrismaService(loadEnv());
  const repo = new PrismaConnectionRepository(prisma);
  const owner = randomUUID();
  const other = randomUUID();

  function connection(id: string) {
    return prisma.connection.create({
      data: {
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
      },
    });
  }

  function audits(connectionId: string) {
    return prisma.auditLog.findMany({
      where: {
        eventType: 'connection.deleted',
        metadata: { path: ['connectionId'], equals: connectionId },
      },
    });
  }

  beforeAll(async () => {
    for (const id of [owner, other]) {
      await prisma.user.create({
        data: {
          id,
          googleSubject: `test:${id}`,
          email: `${id}@example.test`,
          name: 'Delete test',
          lastLoginAt: new Date(),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [owner, other] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await prisma.$disconnect();
  });

  it('deletes and audits together, with the IP address', async () => {
    const id = randomUUID();
    await connection(id);
    expect(await repo.delete(owner, id, '203.0.113.7')).toBe(true);
    expect(await prisma.connection.count({ where: { id } })).toBe(0);
    const rows = await audits(id);
    expect(rows.map((r) => [r.userId, r.ip])).toEqual([[owner, '203.0.113.7']]);
  });

  it("writes nothing for someone else's connection", async () => {
    const id = randomUUID();
    await connection(id);
    expect(await repo.delete(other, id, null)).toBe(false);
    expect(await prisma.connection.count({ where: { id } })).toBe(1);
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
