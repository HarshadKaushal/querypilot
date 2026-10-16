import { randomUUID } from 'node:crypto';
import { AllowedObject, Connection, SchemaSnapshot, User } from '@ayd/database';
import { UniqueConstraintError } from 'sequelize';
import { openAppDatabase } from '../helpers/app-database';

describe('schema snapshot and allowlist tables', () => {
  const db = openAppDatabase();

  afterAll(async () => {
    await db.sequelize.close();
  });

  async function connectionFor(userId: string): Promise<string> {
    await User.create({
      id: userId,
      googleSubject: `test:${userId}`,
      email: `${userId}@example.test`,
      name: 'Schema table test',
      lastLoginAt: new Date(),
    });
    const id = randomUUID();
    await Connection.create({
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
    await SchemaSnapshot.create({ id: randomUUID(), ...snapshot });
    // The unique index schema_snapshots_connection_id_version_key refuses the second row.
    await expect(
      SchemaSnapshot.create({ id: randomUUID(), ...snapshot }),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
    await User.destroy({ where: { id: userId } });
  });

  it('removes snapshots and allowlist rows when the account is deleted', async () => {
    const userId = randomUUID();
    const connectionId = await connectionFor(userId);
    await SchemaSnapshot.create({
      id: randomUUID(),
      connectionId,
      version: 1,
      document: { formatVersion: 1, tables: [] },
      tableCount: 0,
      columnCount: 0,
    });
    await AllowedObject.bulkCreate([
      { id: randomUUID(), connectionId, schemaName: 'public', tableName: 'orders' },
      {
        id: randomUUID(),
        connectionId,
        schemaName: 'public',
        tableName: 'orders',
        columnName: 'total',
        description: 'Order total in dollars',
      },
    ]);

    await User.destroy({ where: { id: userId } });

    expect(await SchemaSnapshot.count({ where: { connectionId } })).toBe(0);
    expect(await AllowedObject.count({ where: { connectionId } })).toBe(0);
  });
});
