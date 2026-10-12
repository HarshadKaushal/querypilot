import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@ayd/database';

describe('schema snapshot and allowlist tables', () => {
  const prisma = createPrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function connectionFor(userId: string): Promise<string> {
    await prisma.user.create({
      data: {
        id: userId,
        googleSubject: `test:${userId}`,
        email: `${userId}@example.test`,
        name: 'Schema table test',
        lastLoginAt: new Date(),
      },
    });
    const id = randomUUID();
    await prisma.connection.create({
      data: {
        id,
        userId,
        label: 'Sample',
        host: 'db.example',
        port: 5432,
        databaseName: 'sample',
        sslMode: 'require',
        usernameCiphertext: 'x',
        usernameIv: 'x',
        usernameTag: 'x',
        passwordCiphertext: 'x',
        passwordIv: 'x',
        passwordTag: 'x',
        encryptedDataKey: 'x',
        dataKeyIv: 'x',
        dataKeyTag: 'x',
        keyVersion: 1,
        status: 'active',
      },
    });
    return id;
  }

  it('keeps one snapshot per connection and version', async () => {
    const userId = randomUUID();
    const connectionId = await connectionFor(userId);
    const snapshot = {
      connectionId,
      version: 1,
      document: { formatVersion: 1, tables: [] },
      tableCount: 0,
      columnCount: 0,
    };
    await prisma.schemaSnapshot.create({ data: { id: randomUUID(), ...snapshot } });
    await expect(
      prisma.schemaSnapshot.create({ data: { id: randomUUID(), ...snapshot } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('removes snapshots and allowlist rows when the account is deleted', async () => {
    const userId = randomUUID();
    const connectionId = await connectionFor(userId);
    await prisma.schemaSnapshot.create({
      data: {
        id: randomUUID(),
        connectionId,
        version: 1,
        document: { formatVersion: 1, tables: [] },
        tableCount: 0,
        columnCount: 0,
      },
    });
    await prisma.allowedObject.createMany({
      data: [
        { id: randomUUID(), connectionId, schemaName: 'public', tableName: 'orders' },
        {
          id: randomUUID(),
          connectionId,
          schemaName: 'public',
          tableName: 'orders',
          columnName: 'total',
          description: 'Order total in dollars',
        },
      ],
    });

    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.schemaSnapshot.count({ where: { connectionId } })).toBe(0);
    expect(await prisma.allowedObject.count({ where: { connectionId } })).toBe(0);
  });
});
