import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ayd/database';
import { writeAuditLog, type AuditEntry } from '../audit/audit-log';
import { PrismaService } from '../prisma/prisma.service';
import type { AllowlistEntry } from './allowed-schema';
import type { SchemaDocument } from './schema-document';
import {
  SNAPSHOTS_KEPT,
  type CommitOutcome,
  type CommitSnapshotInput,
  type DatabaseIdentity,
  type SchemaRepository,
  type StoredSnapshot,
} from './schema.repository';

// A refresh can replace tens of thousands of allowlist rows in one transaction.
const TRANSACTION_TIMEOUT_MS = 30000;

/**
 * Locks this user's connection row until the transaction ends and returns where it points,
 * or null when it is gone or not theirs. Refreshes and allowlist saves take this lock, so
 * they run one at a time per connection and never take the same version number.
 */
async function lockConnection(
  tx: Prisma.TransactionClient,
  userId: string,
  connectionId: string,
): Promise<DatabaseIdentity | null> {
  const rows = await tx.$queryRaw<
    Array<{ host: string; port: number; database_name: string }>
  >`
    SELECT host, port, database_name FROM connections
    WHERE id = ${connectionId} AND user_id = ${userId}
    FOR UPDATE`;
  const row = rows[0];
  return row ? { host: row.host, port: row.port, databaseName: row.database_name } : null;
}

/** Replaces the connection's whole allowlist with `entries`. */
async function replaceEntries(
  tx: Prisma.TransactionClient,
  connectionId: string,
  entries: AllowlistEntry[],
): Promise<void> {
  await tx.allowedObject.deleteMany({ where: { connectionId } });
  if (entries.length > 0) {
    await tx.allowedObject.createMany({
      data: entries.map((entry) => ({ id: randomUUID(), connectionId, ...entry })),
    });
  }
}

@Injectable()
export class PrismaSchemaRepository implements SchemaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async latestSnapshot(
    userId: string,
    connectionId: string,
  ): Promise<StoredSnapshot | null> {
    const row = await this.prisma.schemaSnapshot.findFirst({
      where: { connectionId, connection: { userId } },
      orderBy: { version: 'desc' },
    });
    return row ? toSnapshot(row) : null;
  }

  async allowlist(userId: string, connectionId: string): Promise<AllowlistEntry[]> {
    const rows = await this.prisma.allowedObject.findMany({
      where: { connectionId, connection: { userId } },
      orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }, { columnName: 'asc' }],
    });
    return rows.map(toEntry);
  }

  async commitSnapshot(
    userId: string,
    input: CommitSnapshotInput,
  ): Promise<CommitOutcome> {
    const { connectionId, database } = input;
    return this.prisma.$transaction(
      async (tx) => {
        const current = await lockConnection(tx, userId, connectionId);
        if (!current) {
          return { status: 'missing' };
        }
        // The connection was edited to another database while this snapshot was read.
        if (
          current.host !== database.host ||
          current.port !== database.port ||
          current.databaseName !== database.databaseName
        ) {
          return { status: 'stale' };
        }
        const previous = await tx.schemaSnapshot.findFirst({
          where: { connectionId },
          orderBy: { version: 'desc' },
        });
        const existing = await tx.allowedObject.findMany({ where: { connectionId } });
        const version = (previous?.version ?? 0) + 1;
        const created = await tx.schemaSnapshot.create({
          data: {
            id: randomUUID(),
            connectionId,
            version,
            document: input.document as unknown as Prisma.InputJsonValue,
            tableCount: input.tableCount,
            columnCount: input.columnCount,
          },
        });
        const previousDocument = previous
          ? (previous.document as unknown as SchemaDocument)
          : null;
        await replaceEntries(
          tx,
          connectionId,
          input.nextAllowlist(previousDocument, existing.map(toEntry)),
        );
        await tx.schemaSnapshot.deleteMany({
          where: { connectionId, version: { lte: version - SNAPSHOTS_KEPT } },
        });
        return {
          status: 'committed',
          snapshot: toSnapshot(created),
          previous: previousDocument,
        };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  async replaceAllowlist(
    userId: string,
    connectionId: string,
    version: number,
    entries: AllowlistEntry[],
  ): Promise<'replaced' | 'stale' | 'missing'> {
    return this.prisma.$transaction(
      async (tx) => {
        if (!(await lockConnection(tx, userId, connectionId))) {
          return 'missing';
        }
        const latest = await tx.schemaSnapshot.findFirst({
          where: { connectionId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        if (latest?.version !== version) {
          return 'stale';
        }
        await replaceEntries(tx, connectionId, entries);
        return 'replaced';
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAuditLog(this.prisma, entry);
  }
}

function toSnapshot(row: {
  id: string;
  connectionId: string;
  version: number;
  document: unknown;
  tableCount: number;
  columnCount: number;
  createdAt: Date;
}): StoredSnapshot {
  return {
    id: row.id,
    connectionId: row.connectionId,
    version: row.version,
    document: row.document as SchemaDocument,
    tableCount: row.tableCount,
    columnCount: row.columnCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEntry(row: {
  schemaName: string;
  tableName: string;
  columnName: string | null;
  description: string | null;
}): AllowlistEntry {
  return {
    schemaName: row.schemaName,
    tableName: row.tableName,
    columnName: row.columnName,
    description: row.description,
  };
}
