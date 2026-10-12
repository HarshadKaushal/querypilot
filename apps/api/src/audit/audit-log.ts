import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@ayd/database';

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

/** The single writer for audit rows, used by every Prisma repository. */
export async function writeAuditLog(
  db: Pick<PrismaClient, 'auditLog'>,
  entry: AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      id: randomUUID(),
      userId: entry.userId,
      eventType: entry.eventType,
      metadata: entry.metadata as Prisma.InputJsonObject,
      ip: entry.ip,
    },
  });
}
