import { randomUUID } from 'node:crypto';
import { SequelizeQueryHistory, type NewHistoryEntry } from '@ayd/core';
import { AuditLog, Connection, QueryRecord, User } from '@ayd/database';
import { Op } from 'sequelize';
import { loadEnv } from '../../src/config/env';
import { openAppDatabase } from '../helpers/app-database';

// Phase 8 acceptance for history: entries page newest first with a stable keyset cursor,
// only their owner sees them, deletion works, account deletion removes them, and the table
// has no place for result rows.

describe('query history in PostgreSQL', () => {
  const db = openAppDatabase(loadEnv().DATABASE_URL);
  const history = new SequelizeQueryHistory(db);
  const owner = randomUUID();
  const other = randomUUID();
  const connectionId = randomUUID();

  function entry(id: string, minute: number, userId = owner): NewHistoryEntry {
    return {
      id,
      userId,
      connectionId,
      kind: 'question',
      question: `question ${id}`,
      sql: 'SELECT 1 LIMIT 1001',
      status: 'answered',
      errorCode: null,
      rowCount: 1,
      truncated: null,
      schemaVersion: 1,
      cached: false,
      summary: 'One row.',
      models: ['gemini-3.8-flash'],
      inputTokens: 100,
      outputTokens: 10,
      llmMs: 50,
      queryMs: 5,
      totalMs: 60,
      createdAt: new Date(Date.UTC(2026, 9, 14, 10, minute)),
    };
  }

  beforeAll(async () => {
    for (const id of [owner, other]) {
      await User.create({
        id,
        googleSubject: `test:${id}`,
        email: `${id}@example.test`,
        name: 'History test',
        lastLoginAt: new Date(),
      });
    }
    await Connection.create({
      id: connectionId,
      userId: owner,
      label: 'History',
      host: 'db.example',
      port: 5432,
      databaseName: 'x',
      sslMode: 'require',
      usernameCiphertext: 'u',
      usernameIv: 'u',
      usernameTag: 'u',
      passwordCiphertext: 'p',
      passwordIv: 'p',
      passwordTag: 'p',
      encryptedDataKey: 'k',
      dataKeyIv: 'k',
      dataKeyTag: 'k',
      keyVersion: 1,
      status: 'active',
    });
    // Two entries share a minute, so the id breaks the tie.
    for (const [id, minute] of [
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 3],
      ['e', 5],
    ] as const) {
      await history.record(entry(`${connectionId}-${id}`, minute));
    }
  });

  afterAll(async () => {
    await User.destroy({ where: { id: [owner, other] } });
    await db.sequelize.close();
  });

  it('pages newest first with a cursor, without gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await history.list(owner, 2, cursor);
      seen.push(...result.entries.map((e) => e.id.slice(-1)));
      if (!result.nextCursor) {
        break;
      }
      cursor = result.nextCursor;
    }
    expect(seen).toEqual(['e', 'd', 'c', 'b', 'a']);
  });

  it('shows entries only to their owner', async () => {
    expect((await history.list(other, 10)).entries).toEqual([]);
    await expect(history.get(other, `${connectionId}-a`)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await history.delete(other, `${connectionId}-a`, null)).toBe(false);
  });

  it('records the same job twice as one entry (a retried job)', async () => {
    await history.record({ ...entry(`${connectionId}-a`, 1), summary: 'Updated.' });
    const page = await history.list(owner, 10);
    expect(page.entries.filter((e) => e.id.endsWith('-a'))).toHaveLength(1);
    expect((await history.get(owner, `${connectionId}-a`)).summary).toBe('Updated.');
  });

  it('has no column that could hold result rows', async () => {
    const [columns] = await db.sequelize.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'queries'`,
    );
    const names = (columns as Array<{ column_name: string }>).map((c) => c.column_name);
    expect(names).toContain('sql');
    expect(
      names.filter((name) => /rows|result|data/.test(name) && name !== 'row_count'),
    ).toEqual([]);
  });

  it('deletes one entry, then all, and account deletion removes the rest', async () => {
    expect(await history.delete(owner, `${connectionId}-e`, '203.0.113.7')).toBe(true);
    expect((await history.list(owner, 10)).entries).toHaveLength(4);
    expect(await history.deleteAll(owner, '203.0.113.7')).toBe(4);
    // Each delete wrote its audit row in the same transaction; the refused one wrote none.
    const audits = await AuditLog.findAll({
      where: { userId: [owner, other], eventType: { [Op.startsWith]: 'history.' } },
      order: [['eventType', 'DESC']],
    });
    expect(audits.map((a) => [a.userId, a.eventType, a.metadata, a.ip])).toEqual([
      [owner, 'history.deleted', { entryId: `${connectionId}-e` }, '203.0.113.7'],
      [owner, 'history.cleared', { count: '4' }, '203.0.113.7'],
    ]);
    await AuditLog.destroy({ where: { id: audits.map((a) => a.id) } });
    await history.record(entry(`${connectionId}-z`, 9));
    await User.destroy({ where: { id: owner } });
    expect(await QueryRecord.count({ where: { userId: owner } })).toBe(0);
  });
});
