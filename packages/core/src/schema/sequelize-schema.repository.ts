import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AllowedObject, Connection, SchemaSnapshot } from '@ayd/database';
import { Op, type Transaction } from 'sequelize';
import { writeAuditLog, type AuditEntry } from '../audit/audit-log';
import { DatabaseService } from '../database/database.service';
import type { SchemaDocument } from './schema-document';
import type { AllowlistEntry } from './allowed-schema';
import {
  SNAPSHOTS_KEPT,
  type CommitOutcome,
  type CommitSnapshotInput,
  type DatabaseIdentity,
  type SchemaRepository,
  type StoredSnapshot,
} from './schema.repository';

// A refresh can replace tens of thousands of allowlist rows in one transaction. Prisma
// stopped a transaction after a timeout (raised here to 30 s); Sequelize sets no limit.

/**
 * Locks this user's connection row until the transaction ends and returns where it points,
 * or null when it is gone or not theirs. Refreshes and allowlist saves take this lock, so
 * they run one at a time per connection and never take the same version number.
 */
async function lockConnection(
  transaction: Transaction,
  userId: string,
  connectionId: string,
): Promise<DatabaseIdentity | null> {
  // SELECT host, port, database_name FROM connections WHERE ... FOR UPDATE
  const row = await Connection.findOne({
    attributes: ['host', 'port', 'databaseName'],
    where: { id: connectionId, userId },
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  return row ? { host: row.host, port: row.port, databaseName: row.databaseName } : null;
}

/** Replaces the connection's whole allowlist with `entries`. */
async function replaceEntries(
  transaction: Transaction,
  connectionId: string,
  entries: AllowlistEntry[],
): Promise<void> {
  await AllowedObject.destroy({ where: { connectionId }, transaction });
  if (entries.length > 0) {
    await AllowedObject.bulkCreate(
      entries.map((entry) => ({ id: randomUUID(), connectionId, ...entry })),
      // Nothing reads the inserted rows back, so do not ask Postgres to return them.
      { transaction, returning: false },
    );
  }
}

/** Joins the connection, so a row is found only when its connection is this user's. */
function ownedBy(userId: string) {
  return { model: Connection, attributes: [], where: { userId }, required: true };
}

@Injectable()
export class SequelizeSchemaRepository implements SchemaRepository {
  constructor(private readonly db: DatabaseService) {}

  async latestSnapshot(
    userId: string,
    connectionId: string,
  ): Promise<StoredSnapshot | null> {
    const row = await SchemaSnapshot.findOne({
      where: { connectionId },
      include: [ownedBy(userId)],
      order: [['version', 'DESC']],
    });
    return row ? toSnapshot(row) : null;
  }

  async allowlist(userId: string, connectionId: string): Promise<AllowlistEntry[]> {
    const rows = await AllowedObject.findAll({
      where: { connectionId },
      include: [ownedBy(userId)],
      order: [
        ['schemaName', 'ASC'],
        ['tableName', 'ASC'],
        ['columnName', 'ASC'],
      ],
    });
    return rows.map(toEntry);
  }

  async commitSnapshot(
    userId: string,
    input: CommitSnapshotInput,
  ): Promise<CommitOutcome> {
    const { connectionId, database } = input;
    return this.db.transaction(async (transaction) => {
      const current = await lockConnection(transaction, userId, connectionId);
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
      const previous = await SchemaSnapshot.findOne({
        where: { connectionId },
        order: [['version', 'DESC']],
        transaction,
      });
      const existing = await AllowedObject.findAll({
        where: { connectionId },
        transaction,
      });
      const version = (previous?.version ?? 0) + 1;
      const created = await SchemaSnapshot.create(
        {
          id: randomUUID(),
          connectionId,
          version,
          document: input.document,
          tableCount: input.tableCount,
          columnCount: input.columnCount,
        },
        { transaction },
      );
      const previousDocument = previous ? (previous.document as SchemaDocument) : null;
      await replaceEntries(
        transaction,
        connectionId,
        input.nextAllowlist(previousDocument, existing.map(toEntry)),
      );
      await SchemaSnapshot.destroy({
        where: { connectionId, version: { [Op.lte]: version - SNAPSHOTS_KEPT } },
        transaction,
      });
      return {
        status: 'committed',
        snapshot: toSnapshot(created),
        previous: previousDocument,
      };
    });
  }

  async replaceAllowlist(
    userId: string,
    connectionId: string,
    version: number,
    entries: AllowlistEntry[],
  ): Promise<'replaced' | 'stale' | 'missing'> {
    return this.db.transaction(async (transaction) => {
      if (!(await lockConnection(transaction, userId, connectionId))) {
        return 'missing';
      }
      const latest = await SchemaSnapshot.findOne({
        attributes: ['version'],
        where: { connectionId },
        order: [['version', 'DESC']],
        transaction,
      });
      if (latest?.version !== version) {
        return 'stale';
      }
      await replaceEntries(transaction, connectionId, entries);
      return 'replaced';
    });
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    await writeAuditLog(entry);
  }
}

function toSnapshot(row: SchemaSnapshot): StoredSnapshot {
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

function toEntry(row: AllowedObject): AllowlistEntry {
  return {
    schemaName: row.schemaName,
    tableName: row.tableName,
    columnName: row.columnName,
    description: row.description,
  };
}
