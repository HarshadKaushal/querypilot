import { Injectable } from '@nestjs/common';
import { QueryRecord } from '@ayd/database';
import { Op } from 'sequelize';
import { writeAuditLog } from '../audit/sequelize-audit.repository';
import { DatabaseService } from '../database/database.service';
import { notFound } from '../errors/app.exception';
import {
  decodeCursor,
  encodeCursor,
  type HistoryEntry,
  type HistoryPage,
  type NewHistoryEntry,
  type QueryHistory,
} from './query-history.repository';

// The Sequelize implementation of QueryHistory: reads and writes the `queries` table (model
// QueryRecord), pages newest first with a keyset cursor, and writes the audit row for a
// delete in the same transaction.

function toEntry(row: QueryRecord): HistoryEntry {
  return {
    id: row.id,
    connectionId: row.connectionId,
    kind: row.kind,
    question: row.question,
    sql: row.sql,
    status: row.status,
    errorCode: row.errorCode,
    rowCount: row.rowCount,
    truncated: row.truncated,
    schemaVersion: row.schemaVersion,
    cached: row.cached,
    summary: row.summary,
    models: Array.isArray(row.models) ? row.models : [],
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    llmMs: row.llmMs,
    queryMs: row.queryMs,
    totalMs: row.totalMs,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
  };
}

@Injectable()
export class SequelizeQueryHistory implements QueryHistory {
  constructor(private readonly db: DatabaseService) {}

  async record(entry: NewHistoryEntry): Promise<void> {
    // A job retried after its record was written records the same id again:
    // INSERT ... ON CONFLICT (id) DO UPDATE. The retry also sets a new finished_at.
    await QueryRecord.upsert(entry, { conflictFields: ['id'] });
  }

  async list(userId: string, limit: number, cursor?: string): Promise<HistoryPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after) {
      return { entries: [], nextCursor: null };
    }
    const rows = await QueryRecord.findAll({
      where: {
        userId,
        // Rows older than the cursor: an earlier time, or the same time and a smaller id.
        ...(after
          ? {
              [Op.or]: [
                { createdAt: { [Op.lt]: after.createdAt } },
                { createdAt: after.createdAt, id: { [Op.lt]: after.id } },
              ],
            }
          : {}),
      },
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      // One extra row says whether another page exists.
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      entries: page.map(toEntry),
      nextCursor:
        rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(userId: string, id: string): Promise<HistoryEntry> {
    const row = await QueryRecord.findOne({ where: { id, userId } });
    if (!row) {
      throw notFound();
    }
    return toEntry(row);
  }

  async delete(userId: string, id: string, ip: string | null): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const deleted = await QueryRecord.destroy({ where: { id, userId }, transaction });
      if (deleted === 0) {
        return false;
      }
      await writeAuditLog(
        { userId, eventType: 'history.deleted', metadata: { entryId: id }, ip },
        transaction,
      );
      return true;
    });
  }

  async deleteAll(userId: string, ip: string | null): Promise<number> {
    return this.db.transaction(async (transaction) => {
      const count = await QueryRecord.destroy({ where: { userId }, transaction });
      await writeAuditLog(
        { userId, eventType: 'history.cleared', metadata: { count: String(count) }, ip },
        transaction,
      );
      return count;
    });
  }
}
