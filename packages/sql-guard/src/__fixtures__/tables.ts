import type { GuardTable } from '../types';

function table(
  schema: string,
  name: string,
  columns: string[],
  hidden: string[] = [],
  allowed = true,
): GuardTable {
  return {
    schema,
    name,
    allowed,
    columns: [...columns, ...hidden].map((column) => ({
      name: column,
      allowed: !hidden.includes(column),
    })),
  };
}

// Mirrors the sample database. Hidden columns and one hidden table exercise the allowlist.
// support.tickets.name is hidden while customers.name is allowed, so an unqualified `name`
// in a subquery over tickets must not slip through as the outer customers.name.
export const TABLES: GuardTable[] = [
  table('public', 'customers', ['id', 'name', 'region', 'created_at'], ['email']),
  table('public', 'orders', ['id', 'customer_id', 'ordered_on', 'status']),
  table('public', 'order_items', [
    'id',
    'order_id',
    'product_id',
    'quantity',
    'unit_price',
  ]),
  table('public', 'products', ['id', 'sku', 'name', 'category', 'unit_price']),
  table('public', 'payments', ['id', 'order_id', 'paid_on', 'method', 'amount']),
  table('public', 'staff_notes', ['id', 'body'], [], false),
  // Allowed, but every column hidden: count(*) works, SELECT * has nothing to list.
  table('public', 'shipments', [], ['tracking_code']),
  table('inventory', 'warehouses', ['id', 'name', 'region']),
  table('inventory', 'stock_levels', ['warehouse_id', 'product_id', 'on_hand']),
  table(
    'support',
    'tickets',
    ['id', 'customer_id', 'opened_on', 'status'],
    ['contact_phone', 'name'],
  ),
];

export const ROW_CAP = 1000;
