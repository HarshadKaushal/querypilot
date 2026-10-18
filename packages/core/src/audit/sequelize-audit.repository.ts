import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditLog } from '@ayd/database';
import type { Transaction } from 'sequelize';
import type { AuditEntry, AuditWriter } from './audit.repository';

/**
 * The single writer for audit rows, used by every Sequelize repository. Pass `transaction`
 * to write the row in the same transaction as the change it records.
 */
export async function writeAuditLog(
  entry: AuditEntry,
  transaction?: Transaction,
): Promise<void> {
  await AuditLog.create(
    {
      id: randomUUID(),
      userId: entry.userId,
      eventType: entry.eventType,
      metadata: entry.metadata,
      ip: entry.ip,
    },
    { transaction },
  );
}

@Injectable()
export class SequelizeAuditWriter implements AuditWriter {
  async write(entry: AuditEntry): Promise<void> {
    await writeAuditLog(entry);
  }
}
