import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FUNCTIONS } from './allowlists';
import { ALLOWED_FUNCTIONS, checkSql, MAX_SQL_LENGTH, type GuardVerdict } from './index';
import { ATTACKS } from './__fixtures__/attacks';
import { SAFE } from './__fixtures__/safe';
import { ROW_CAP, TABLES } from './__fixtures__/tables';

const options = { tables: TABLES, rowCap: ROW_CAP };

async function accepted(sql: string, rowCap = ROW_CAP) {
  const verdict = await checkSql(sql, { tables: TABLES, rowCap });
  if (!verdict.ok) {
    throw new Error(`rejected as ${verdict.code}: ${verdict.reason}`);
  }
  return verdict;
}

async function rejected(sql: string): Promise<Extract<GuardVerdict, { ok: false }>> {
  const verdict = await checkSql(sql, options);
  if (verdict.ok) {
    throw new Error(`accepted as ${verdict.sql}`);
  }
  return verdict;
}

describe('attack corpus', () => {
  it.each(ATTACKS)('rejects %j as %s', async (sql, code) => {
    expect((await rejected(sql)).code).toBe(code);
  });
});

describe('safe corpus', () => {
  it.each(SAFE)('accepts %j and its output is stable', async (sql) => {
    const first = await accepted(sql);
    const second = await accepted(first.sql);
    expect(second.sql).toBe(first.sql);
  });
});

describe('rewriting', () => {
  it.each([
    [
      'SELECT name FROM customers',
      'SELECT customers.name FROM public.customers LIMIT 1001',
    ],
    [
      'SELECT * FROM customers',
      'SELECT customers.id, customers.name, customers.region, customers.created_at FROM public.customers LIMIT 1001',
    ],
    [
      'SELECT t.* FROM support.tickets t',
      'SELECT t.id, t.customer_id, t.opened_on, t.status FROM support.tickets AS t LIMIT 1001',
    ],
    [
      "SELECT name FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE region = 'North')",
      "SELECT customers.name FROM public.customers WHERE customers.id IN (SELECT orders.customer_id FROM public.orders WHERE customers.region = 'North') LIMIT 1001",
    ],
    [
      'SELECT sum(amount) AS total FROM payments ORDER BY total',
      'SELECT sum(payments.amount) AS total FROM public.payments ORDER BY total LIMIT 1001',
    ],
    [
      'WITH paid AS (SELECT order_id FROM payments) SELECT order_id FROM paid',
      'WITH paid AS (SELECT payments.order_id FROM public.payments) SELECT paid.order_id FROM paid LIMIT 1001',
    ],
    [
      'SELECT id FROM orders -- ; DROP TABLE orders',
      'SELECT orders.id FROM public.orders LIMIT 1001',
    ],
  ])('%s', async (sql, expected) => {
    expect((await accepted(sql)).sql).toBe(expected);
  });

  it('never lists a hidden column when expanding *', async () => {
    const { sql } = await accepted('SELECT * FROM support.tickets');
    expect(sql).not.toContain('contact_phone');
    expect(sql).not.toMatch(/\bname\b/);
  });
});

describe('row cap', () => {
  it.each([
    ['SELECT id FROM orders', 'LIMIT 1001', true],
    ['SELECT id FROM orders LIMIT 5', 'LIMIT 5', false],
    ['SELECT id FROM orders LIMIT 0', 'LIMIT 0', false],
    ['SELECT id FROM orders LIMIT 1000', 'LIMIT 1000', false],
    ['SELECT id FROM orders LIMIT 1001', 'LIMIT 1001', true],
    ['SELECT id FROM orders LIMIT 5000', 'LIMIT 1001', true],
    ['SELECT id FROM orders LIMIT ALL', 'LIMIT 1001', true],
    ['SELECT id FROM orders FETCH FIRST 3 ROWS ONLY', 'LIMIT 3', false],
  ] as const)('%s ends with %s', async (sql, limit, applied) => {
    const verdict = await accepted(sql);
    expect(verdict.sql.endsWith(limit)).toBe(true);
    expect(verdict.limitApplied).toBe(applied);
  });

  it('caps the whole result of a UNION, not each side', async () => {
    const { sql } = await accepted(
      'SELECT id FROM orders UNION SELECT order_id FROM payments',
    );
    expect(sql.match(/LIMIT/g)).toHaveLength(1);
    expect(sql.endsWith('LIMIT 1001')).toBe(true);
  });

  it('leaves limits inside subqueries alone', async () => {
    const { sql } = await accepted(
      'SELECT s.id FROM (SELECT id FROM orders LIMIT 5000) AS s',
    );
    expect(sql).toContain('LIMIT 5000');
    expect(sql.endsWith('LIMIT 1001')).toBe(true);
  });

  it('uses the cap it is given', async () => {
    expect((await accepted('SELECT id FROM orders', 25)).sql.endsWith('LIMIT 26')).toBe(
      true,
    );
  });

  it('refuses a cap that is not a positive whole number', async () => {
    await expect(checkSql('SELECT 1', { tables: TABLES, rowCap: 0 })).rejects.toThrow(
      'rowCap',
    );
  });
});

describe('reasons', () => {
  it.each([
    ['SELECT email FROM customers', 'public.customers.email'],
    ['SELECT id FROM staff_notes', 'public.staff_notes'],
    ['SELECT pg_sleep(1)', 'pg_sleep'],
    ["SELECT 'x'::regclass", 'regclass'],
    ['DELETE FROM orders', 'DELETE'],
    ['SELECT id FROM customers, orders', 'id'],
  ])('%s names %s', async (sql, name) => {
    expect((await rejected(sql)).reason).toContain(name);
  });

  it('explains the parse error', async () => {
    expect((await rejected('SELEC 1')).reason).toContain('syntax error');
  });
});

describe('limits on the input', () => {
  it('refuses SQL longer than the maximum', async () => {
    const sql = `SELECT 1 /* ${'x'.repeat(MAX_SQL_LENGTH)} */`;
    expect((await rejected(sql)).code).toBe('too_long');
  });

  it('refuses expressions nested too deeply', async () => {
    // Parentheses vanish in the parse tree, so nest operators instead.
    const sql = `SELECT ${'1 + ('.repeat(150)}1${')'.repeat(150)}`;
    expect((await rejected(sql)).code).toBe('too_complex');
  });
});

describe('package', () => {
  it('depends only on the PostgreSQL parser and deparser, with no network or database client', () => {
    const manifest = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      'libpg-query',
      'pgsql-deparser',
    ]);
  });

  it('exports the same function allowlist the guard checks, for the model prompt', () => {
    expect(ALLOWED_FUNCTIONS).toBe(FUNCTIONS);
    expect(ALLOWED_FUNCTIONS.size).toBeGreaterThan(0);
  });
});
