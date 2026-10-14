import { Injectable } from '@nestjs/common';
import type { Prisma } from '@ayd/database';
import { notFound } from '../errors/app.exception';
import type {
  AskJobData,
  AskResult,
  JobOutcome,
  QueryJobData,
  QueryJobResult,
} from '../jobs/job.types';
import { PrismaService } from '../prisma/prisma.service';

/** One history entry as its owner sees it. Never result rows. */
export interface HistoryEntry {
  id: string;
  connectionId: string;
  kind: 'question' | 'sql';
  question: string | null;
  /** The SQL that ran, as the guard rewrote it. Null when nothing ran. */
  sql: string | null;
  status: 'answered' | 'ambiguous' | 'unanswerable' | 'failed' | 'cancelled';
  errorCode: string | null;
  rowCount: number | null;
  truncated: string | null;
  schemaVersion: number | null;
  cached: boolean;
  summary: string | null;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  llmMs: number;
  queryMs: number;
  totalMs: number;
  createdAt: string;
  finishedAt: string;
}

export type NewHistoryEntry = Omit<HistoryEntry, 'createdAt' | 'finishedAt'> & {
  userId: string;
  createdAt: Date;
};

export interface HistoryPage {
  entries: HistoryEntry[];
  /** Pass back as `cursor` for the next, older page. Null on the last page. */
  nextCursor: string | null;
}

/** Records finished question and SQL jobs, and serves them to their owner. */
export interface QueryHistory {
  record(entry: NewHistoryEntry): Promise<void>;
  list(userId: string, limit: number, cursor?: string): Promise<HistoryPage>;
  get(userId: string, id: string): Promise<HistoryEntry>;
  delete(userId: string, id: string): Promise<boolean>;
  deleteAll(userId: string): Promise<number>;
}

export const QUERY_HISTORY = Symbol('QUERY_HISTORY');

/**
 * The history entry for a finished job, or null for kinds history does not keep. Built
 * from the outcome the owner saw, so history and the job view agree.
 */
export function historyEntryFor(job: {
  id: string;
  kind: string;
  data: unknown;
  createdAt: Date;
  outcome: JobOutcome<unknown>;
}): NewHistoryEntry | null {
  if (job.kind !== 'question.ask' && job.kind !== 'query.run') {
    return null;
  }
  const data = job.data as Partial<AskJobData & QueryJobData>;
  const base = {
    id: job.id,
    userId: data.userId ?? '',
    connectionId: data.connectionId ?? '',
    kind: job.kind === 'question.ask' ? ('question' as const) : ('sql' as const),
    question: job.kind === 'question.ask' ? (data.question ?? null) : null,
    sql: job.kind === 'query.run' ? (data.sql ?? null) : null,
    errorCode: null,
    rowCount: null,
    truncated: null,
    schemaVersion: null,
    cached: false,
    summary: null,
    models: [] as string[],
    inputTokens: 0,
    outputTokens: 0,
    llmMs: 0,
    queryMs: 0,
    totalMs: 0,
    createdAt: job.createdAt,
  };
  if (!job.outcome.ok) {
    return {
      ...base,
      status: job.outcome.error.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed',
      errorCode: job.outcome.error.code,
    };
  }
  if (job.kind === 'query.run') {
    const result = job.outcome.result as QueryJobResult;
    return {
      ...base,
      status: 'answered',
      sql: result.sql,
      rowCount: result.rowCount,
      truncated: result.truncated || null,
      schemaVersion: result.schemaVersion,
      queryMs: result.durationMs,
      totalMs: result.durationMs,
    };
  }
  const result = job.outcome.result as AskResult;
  const usage = result.usage;
  const shared = {
    ...base,
    status: result.status,
    schemaVersion: result.schemaVersion,
    cached: result.cached,
    models: usage?.models ?? [],
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    llmMs: usage?.llmMs ?? 0,
    totalMs: usage?.totalMs ?? 0,
  };
  if (result.status !== 'answered') {
    return { ...shared, summary: result.explanation };
  }
  return {
    ...shared,
    sql: result.sql,
    rowCount: result.rowCount,
    truncated: result.truncated || null,
    summary: result.summary.text,
    queryMs: result.durationMs,
  };
}

/** Keyset cursor: the last entry's creation time and id, so pages stay stable as rows arrive. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [time, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(time ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    return null;
  }
  return { createdAt, id };
}

type Row = Awaited<ReturnType<PrismaService['queryRecord']['findFirstOrThrow']>>;

function toEntry(row: Row): HistoryEntry {
  return {
    id: row.id,
    connectionId: row.connectionId,
    kind: row.kind as HistoryEntry['kind'],
    question: row.question,
    sql: row.sql,
    status: row.status as HistoryEntry['status'],
    errorCode: row.errorCode,
    rowCount: row.rowCount,
    truncated: row.truncated,
    schemaVersion: row.schemaVersion,
    cached: row.cached,
    summary: row.summary,
    models: Array.isArray(row.models) ? (row.models as string[]) : [],
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
export class PrismaQueryHistory implements QueryHistory {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: NewHistoryEntry): Promise<void> {
    const { models, ...fields } = entry;
    const data = { ...fields, models: models as Prisma.InputJsonArray };
    // A job retried after its record was written records the same id again.
    await this.prisma.queryRecord.upsert({
      where: { id: entry.id },
      create: data,
      update: data,
    });
  }

  async list(userId: string, limit: number, cursor?: string): Promise<HistoryPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after) {
      return { entries: [], nextCursor: null };
    }
    const rows = await this.prisma.queryRecord.findMany({
      where: {
        userId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra row says whether another page exists.
      take: limit + 1,
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
    const row = await this.prisma.queryRecord.findFirst({ where: { id, userId } });
    if (!row) {
      throw notFound();
    }
    return toEntry(row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.queryRecord.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }

  async deleteAll(userId: string): Promise<number> {
    return (await this.prisma.queryRecord.deleteMany({ where: { userId } })).count;
  }
}
