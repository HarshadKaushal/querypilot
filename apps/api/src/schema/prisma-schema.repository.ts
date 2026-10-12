import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@ayd/database';
import { PrismaService } from '../prisma/prisma.service';
import type { AllowlistEntry } from './allowed-schema';
import type { SchemaDocument } from './schema-document';
import {
  SNAPSHOTS_KEPT,
  type CommitSnapshotInput,
  type SchemaRepository,
  type StoredSnapshot,
} from './schema.repository';

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
  ): Promise<{ snapshot: StoredSnapshot; previous: SchemaDocument | null } | null> {
    const { connectionId } = input;
    return this.prisma.$transaction(
      async (tx) => {
        // Locks the connection row, so two refreshes of one connection run one after the
        // other and never take the same version number.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM connections
          WHERE id = ${connectionId} AND user_id = ${userId}
          FOR UPDATE`;
        if (locked.length === 0) {
          return null;
        }
        const previous = await tx.schemaSnapshot.findFirst({
          where: { connectionId },
          orderBy: { version: 'desc' },
        });
        const current = await tx.allowedObject.findMany({ where: { connectionId } });
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
        const next = input.nextAllowlist(previousDocument, current.map(toEntry));
        await tx.allowedObject.deleteMany({ where: { connectionId } });
        if (next.length > 0) {
          await tx.allowedObject.createMany({
            data: next.map((entry) => ({ id: randomUUID(), connectionId, ...entry })),
          });
        }
        await tx.schemaSnapshot.deleteMany({
          where: { connectionId, version: { lte: version - SNAPSHOTS_KEPT } },
        });
        return { snapshot: toSnapshot(created), previous: previousDocument };
      },
      { timeout: 30000 },
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
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM connections
          WHERE id = ${connectionId} AND user_id = ${userId}
          FOR UPDATE`;
        if (locked.length === 0) {
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
        await tx.allowedObject.deleteMany({ where: { connectionId } });
        if (entries.length > 0) {
          await tx.allowedObject.createMany({
            data: entries.map((entry) => ({ id: randomUUID(), connectionId, ...entry })),
          });
        }
        return 'replaced';
      },
      { timeout: 30000 },
    );
  }

  async writeAudit(input: {
    userId: string;
    eventType: string;
    metadata: Record<string, string>;
    ip: string | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        eventType: input.eventType,
        metadata: input.metadata as Prisma.InputJsonObject,
        ip: input.ip,
      },
    });
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
