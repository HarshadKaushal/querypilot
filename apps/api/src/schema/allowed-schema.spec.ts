import {
  allowedSchema,
  allowlistView,
  defaultAllowlist,
  newObjects,
  reconcileAllowlist,
  schemaFingerprint,
  type AllowlistEntry,
} from './allowed-schema';
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
        { name: 'name', type: 'text', nullable: false },
        { name: 'email', type: 'text', nullable: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
    {
      schema: 'public',
      name: 'orders',
      kind: 'table',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'customer_id', type: 'integer', nullable: false },
        { name: 'total', type: 'numeric(12,2)', nullable: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          columns: ['customer_id'],
          references: { schema: 'public', table: 'customers', columns: ['id'] },
        },
      ],
    },
    {
      schema: 'sales',
      name: 'targets',
      kind: 'table',
      columns: [{ name: 'region', type: 'text', nullable: false }],
      primaryKey: ['region'],
      foreignKeys: [],
    },
  ],
};

function entry(
  schemaName: string,
  tableName: string,
  columnName: string | null = null,
  description: string | null = null,
): AllowlistEntry {
  return { schemaName, tableName, columnName, description };
}

describe('defaultAllowlist', () => {
  it('allows every table and every column except the sensitive ones', () => {
    const entries = defaultAllowlist(document);
    const names = entries.map((item) =>
      [item.schemaName, item.tableName, item.columnName].filter(Boolean).join('.'),
    );
    expect(names).toContain('public.customers');
    expect(names).toContain('public.customers.name');
    expect(names).not.toContain('public.customers.email');
    expect(names).toContain('sales.targets.region');
    expect(entries.every((item) => item.description === null)).toBe(true);
  });
});

describe('allowedSchema', () => {
  it('returns nothing that is not on the allowlist', () => {
    const entries = [
      entry('public', 'orders'),
      entry('public', 'orders', 'id'),
      entry('public', 'orders', 'total'),
      entry('public', 'customers', 'name'),
    ];
    const tables = allowedSchema(document, entries);
    const allowed = new Set(
      entries.map((item) => `${item.schemaName}.${item.tableName}.${item.columnName}`),
    );
    for (const table of tables) {
      expect(allowed.has(`${table.schema}.${table.name}.null`)).toBe(true);
      for (const column of table.columns) {
        expect(allowed.has(`${table.schema}.${table.name}.${column.name}`)).toBe(true);
      }
      for (const name of table.primaryKey) {
        expect(allowed.has(`${table.schema}.${table.name}.${name}`)).toBe(true);
      }
    }
    // customers has a column entry but no table entry, so it stays hidden.
    expect(tables.map((table) => table.name)).toEqual(['orders']);
    expect(JSON.stringify(tables)).not.toContain('customer_id');
  });

  it('drops a foreign key whose target table or column is hidden', () => {
    const base = [
      entry('public', 'orders'),
      entry('public', 'orders', 'customer_id'),
      entry('public', 'customers'),
    ];
    expect(allowedSchema(document, base)[1]?.foreignKeys).toEqual([]);
    const withTarget = [...base, entry('public', 'customers', 'id')];
    expect(allowedSchema(document, withTarget)[1]?.foreignKeys).toEqual([
      {
        columns: ['customer_id'],
        references: { schema: 'public', table: 'customers', columns: ['id'] },
      },
    ]);
  });

  it('drops a primary key that names a hidden column, and attaches descriptions', () => {
    const tables = allowedSchema(document, [
      entry('public', 'customers', null, 'People who buy from us'),
      entry('public', 'customers', 'name', 'Trading name'),
    ]);
    expect(tables[0]).toMatchObject({
      name: 'customers',
      description: 'People who buy from us',
      primaryKey: [],
      columns: [{ name: 'name', description: 'Trading name' }],
    });
  });
});

describe('reconcileAllowlist', () => {
  it('drops entries for objects that no longer exist and adds nothing new', () => {
    const entries = [
      entry('public', 'orders'),
      entry('public', 'orders', 'total', 'Order total'),
      entry('public', 'orders', 'discount'),
      entry('public', 'gone'),
    ];
    expect(reconcileAllowlist(entries, document)).toEqual([
      entry('public', 'orders'),
      entry('public', 'orders', 'total', 'Order total'),
    ]);
  });
});

describe('newObjects', () => {
  it('lists tables and columns the previous snapshot did not have', () => {
    const previous: SchemaDocument = {
      formatVersion: 1,
      tables: [
        {
          ...document.tables[1]!,
          columns: document.tables[1]!.columns.filter(
            (column) => column.name !== 'total',
          ),
        },
      ],
    };
    expect(newObjects(previous, document)).toEqual({
      tables: ['public.customers', 'sales.targets'],
      columns: ['public.orders.total'],
    });
  });
});

describe('schemaFingerprint', () => {
  const entries = defaultAllowlist(document);

  it('is stable for the same version and allowlist', () => {
    expect(schemaFingerprint(1, allowedSchema(document, entries))).toBe(
      schemaFingerprint(1, allowedSchema(document, [...entries])),
    );
  });

  it('changes with the version, the allowlist, or a description', () => {
    const base = schemaFingerprint(1, allowedSchema(document, entries));
    expect(schemaFingerprint(2, allowedSchema(document, entries))).not.toBe(base);
    expect(schemaFingerprint(1, allowedSchema(document, entries.slice(1)))).not.toBe(
      base,
    );
    const described = entries.map((item, position) =>
      position === 0 ? { ...item, description: 'Customers' } : item,
    );
    expect(schemaFingerprint(1, allowedSchema(document, described))).not.toBe(base);
  });
});

describe('allowlistView', () => {
  it('lists every object with its allowed and sensitive flags', () => {
    const view = allowlistView(document, defaultAllowlist(document));
    expect(view).toHaveLength(3);
    expect(view[0]?.columns.find((column) => column.name === 'email')).toEqual({
      name: 'email',
      type: 'text',
      nullable: false,
      allowed: false,
      sensitive: true,
      description: null,
    });
    expect(view[0]?.allowed).toBe(true);
  });
});
