import { describe, expect, it } from 'vitest';
import type { SchemaView } from '../../../lib/api-types';
import { examplesFor } from '../examples';
import { formatWait } from './FailureView';
import { formatCell, sortRows, toNumber } from './format';
import { chartData } from './ResultChart';

describe('cell helpers', () => {
  it('reads numbers PostgreSQL sends as text, and nothing else', () => {
    expect(toNumber('1250.50')).toBe(1250.5);
    expect(toNumber(7)).toBe(7);
    expect(toNumber('North')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it('sorts numbers by value, text alphabetically, and empty cells last', () => {
    const rows = [
      ['b', '10'],
      ['a', '9'],
      [null, '100'],
      ['c', null],
    ];
    expect(sortRows(rows, 1, 'asc').map((r) => r[1])).toEqual(['9', '10', '100', null]);
    expect(sortRows(rows, 0, 'desc').map((r) => r[0])).toEqual(['c', 'b', 'a', null]);
  });

  it('shows objects as JSON and null as empty', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
    expect(formatCell(null)).toBe('');
  });
});

describe('chartData', () => {
  it('turns rows into points keyed by column name, with numbers parsed', () => {
    expect(
      chartData({
        type: 'bar',
        x: 'region',
        y: ['orders', 'revenue'],
        points: [
          ['North', '2', '1250.00'],
          ['South', 5, null],
        ],
      }),
    ).toEqual([
      { region: 'North', orders: 2, revenue: 1250 },
      { region: 'South', orders: 5, revenue: 0 },
    ]);
  });
});

describe('formatWait', () => {
  it('says seconds, minutes, or hours', () => {
    expect(formatWait(30)).toBe('30 seconds');
    expect(formatWait(600)).toBe('about 10 minutes');
    expect(formatWait(7 * 3600)).toBe('about 7 hours');
  });
});

describe('examplesFor', () => {
  it('suggests a count, a count per related row, and a count over time', () => {
    const schema: SchemaView = {
      connectionId: 'c1',
      version: 1,
      tables: [
        {
          schema: 'public',
          name: 'customers',
          kind: 'table',
          columns: [{ name: 'id', type: 'integer', nullable: false }],
          foreignKeys: [],
        },
        {
          schema: 'public',
          name: 'orders',
          kind: 'table',
          columns: [
            { name: 'placed_at', type: 'timestamp with time zone', nullable: false },
          ],
          foreignKeys: [
            {
              columns: ['customer_id'],
              references: { schema: 'public', table: 'customers', columns: ['id'] },
            },
          ],
        },
      ],
    };
    expect(examplesFor(schema)).toEqual([
      'How many customers are there?',
      'How many orders does each customer have?',
      'How many orders were there each month?',
    ]);
  });

  it('suggests nothing when no table is allowed', () => {
    expect(examplesFor({ connectionId: 'c1', version: 1, tables: [] })).toEqual([]);
  });
});
