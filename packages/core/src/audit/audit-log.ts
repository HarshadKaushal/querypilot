import { randomUUID } from 'node:crypto';
import { AuditLog } from '@ayd/database';
import type { Transaction } from 'sequelize';

/**
 * One audit_log row. Metadata holds ids and outcomes only: never passwords, tokens, emails,
 * or result rows. userId is null once the account has been deleted.
 */
export interface AuditEntry {
  userId: string | null;
  eventType: string;
  metadata: Record<string, string>;
  ip: string | null;
}

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
