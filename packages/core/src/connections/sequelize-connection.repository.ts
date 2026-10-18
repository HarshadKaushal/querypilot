import { Injectable } from '@nestjs/common';
import { AllowedObject, Connection, SchemaSnapshot } from '@ayd/database';
import type { AuditEntry } from '../audit/audit.repository';
import { writeAuditLog } from '../audit/sequelize-audit.repository';
import { DatabaseService } from '../database/database.service';
import {
  toPublicConnection,
  type ConnectionRepository,
  type NewConnection,
  type PublicConnection,
  type StoredConnection,
} from './connection.repository';

@Injectable()
export class SequelizeConnectionRepository implements ConnectionRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(input: NewConnection): Promise<PublicConnection> {
    const row = await Connection.create(input);
    return toPublicConnection(row);
  }

  async list(userId: string): Promise<PublicConnection[]> {
    const rows = await Connection.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => toPublicConnection(row));
  }

  async findOwned(userId: string, id: string): Promise<StoredConnection | null> {
    const row = await Connection.findOne({ where: { id, userId } });
    return row ? toStored(row) : null;
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<NewConnection>,
    options: { resetSchema?: boolean } = {},
  ): Promise<PublicConnection | null> {
    return this.db.transaction(async (transaction) => {
      const existing = await Connection.findOne({ where: { id, userId }, transaction });
      if (!existing) {
        return null;
      }
      const row = await existing.update(withoutUndefined(patch), { transaction });
      if (options.resetSchema) {
        // The connection now points at another database, so the old schema and choices
        // must not be applied to it.
        await AllowedObject.destroy({ where: { connectionId: id }, transaction });
        await SchemaSnapshot.destroy({ where: { connectionId: id }, transaction });
      }
      return toPublicConnection(row);
    });
  }

  async delete(userId: string, id: string, ip: string | null): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const deleted = await Connection.destroy({ where: { id, userId }, transaction });
      if (deleted !== 1) {
        return false;
      }
      await writeAuditLog(
        { userId, eventType: 'connection.deleted', metadata: { connectionId: id }, ip },
        transaction,
      );
      return true;
    });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAuditLog(entry);
  }
}

/**
 * Drops keys whose value is undefined. Sequelize would write NULL for them, but a partial
 * patch must leave the fields it does not mention as they are.
 */
function withoutUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function toStored(row: Connection): StoredConnection {
  return {
    ...toPublicConnection(row),
    userId: row.userId,
    usernameCiphertext: row.usernameCiphertext,
    usernameIv: row.usernameIv,
    usernameTag: row.usernameTag,
    passwordCiphertext: row.passwordCiphertext,
    passwordIv: row.passwordIv,
    passwordTag: row.passwordTag,
    encryptedDataKey: row.encryptedDataKey,
    dataKeyIv: row.dataKeyIv,
    dataKeyTag: row.dataKeyTag,
    keyVersion: row.keyVersion,
  };
}
