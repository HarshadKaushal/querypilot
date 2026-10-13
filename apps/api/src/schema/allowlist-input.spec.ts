import {
  cleanDescription,
  DESCRIPTION_MAX,
  parseAllowlistInput,
} from './allowlist-input';
import type { SchemaDocument } from '@ayd/core';

const document: SchemaDocument = {
  formatVersion: 1,
  tables: [
    {
      schema: 'public',
      name: 'customers',
      kind: 'table',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'email', type: 'text', nullable: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
  ],
};

describe('parseAllowlistInput', () => {
  it('turns nested tables and columns into allowlist rows', () => {
    expect(
      parseAllowlistInput(
        {
          version: 3,
          tables: [
            {
              schema: 'public',
              name: 'customers',
              description: 'People who buy',
              columns: [
                { name: 'id' },
                { name: 'email', description: 'Billing contact' },
              ],
            },
          ],
        },
        document,
      ),
    ).toEqual({
      ok: true,
      version: 3,
      entries: [
        {
          schemaName: 'public',
          tableName: 'customers',
          columnName: null,
          description: 'People who buy',
        },
        {
          schemaName: 'public',
          tableName: 'customers',
          columnName: 'id',
          description: null,
        },
        {
          schemaName: 'public',
          tableName: 'customers',
          columnName: 'email',
          description: 'Billing contact',
        },
      ],
    });
  });

  it('accepts an empty allowlist and a table with no columns', () => {
    expect(parseAllowlistInput({ version: 1, tables: [] }, document)).toEqual({
      ok: true,
      version: 1,
      entries: [],
    });
    const tableOnly = parseAllowlistInput(
      { version: 1, tables: [{ schema: 'public', name: 'customers' }] },
      document,
    );
    expect(tableOnly.ok && tableOnly.entries).toHaveLength(1);
  });

  // [case, body, expected reason]
  const rejected: Array<[string, unknown, 'invalid' | 'unknown_object']> = [
    ['no body', undefined, 'invalid'],
    ['no version', { tables: [] }, 'invalid'],
    ['tables not a list', { version: 1, tables: {} }, 'invalid'],
    ['table without a name', { version: 1, tables: [{ schema: 'public' }] }, 'invalid'],
    [
      'unknown table',
      { version: 1, tables: [{ schema: 'public', name: 'orders' }] },
      'unknown_object',
    ],
    [
      'table in the wrong schema',
      { version: 1, tables: [{ schema: 'sales', name: 'customers' }] },
      'unknown_object',
    ],
    [
      'unknown column',
      {
        version: 1,
        tables: [{ schema: 'public', name: 'customers', columns: [{ name: 'x' }] }],
      },
      'unknown_object',
    ],
    [
      'duplicate table',
      {
        version: 1,
        tables: [
          { schema: 'public', name: 'customers' },
          { schema: 'public', name: 'customers' },
        ],
      },
      'invalid',
    ],
    [
      'duplicate column',
      {
        version: 1,
        tables: [
          {
            schema: 'public',
            name: 'customers',
            columns: [{ name: 'id' }, { name: 'id' }],
          },
        ],
      },
      'invalid',
    ],
    [
      'description too long',
      {
        version: 1,
        tables: [
          {
            schema: 'public',
            name: 'customers',
            description: 'x'.repeat(DESCRIPTION_MAX + 1),
          },
        ],
      },
      'invalid',
    ],
    [
      'description not text',
      { version: 1, tables: [{ schema: 'public', name: 'customers', description: 7 }] },
      'invalid',
    ],
  ];

  it.each(rejected)('rejects %s', (_name, body, reason) => {
    expect(parseAllowlistInput(body, document)).toEqual({ ok: false, reason });
  });
});

describe('cleanDescription', () => {
  it('collapses whitespace, removes control characters, and treats blank as none', () => {
    expect(cleanDescription('  Order\n\n total\tin  dollars ')).toBe(
      'Order total in dollars',
    );
    expect(cleanDescription('Total\u0000\u0007')).toBe('Total');
    expect(cleanDescription('   ')).toBeNull();
    expect(cleanDescription(undefined)).toBeNull();
    expect(cleanDescription(null)).toBeNull();
    expect(cleanDescription('x'.repeat(DESCRIPTION_MAX))).toHaveLength(DESCRIPTION_MAX);
  });
});
