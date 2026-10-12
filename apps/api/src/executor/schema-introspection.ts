import type {
  RelationKind,
  SchemaDocument,
  SchemaForeignKey,
  SchemaTable,
} from '../schema/schema-document';
import type { PgClientLike } from './user-database.probe';

// Reads the structure the login can see from pg_catalog. Only names, types, nullability,
// and keys: no rows and no comments. The caller runs this inside a READ ONLY transaction.

export interface IntrospectionLimits {
  tables: number;
  columns: number;
}

export const DEFAULT_LIMITS: IntrospectionLimits = { tables: 2000, columns: 50000 };

const KINDS: Record<string, RelationKind> = {
  r: 'table',
  p: 'partitioned_table',
  v: 'view',
  m: 'materialized_view',
  f: 'foreign_table',
};

// Relations the login can read in schemas it can use. Partitions are reached through their
// parent, and objects that belong to an extension are not the user's data.
const RELATIONS = `
  SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind AS kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND NOT c.relispartition
    AND n.nspname !~ '^pg_'
    AND n.nspname <> 'information_schema'
    AND has_schema_privilege(n.oid, 'USAGE')
    AND has_any_column_privilege(c.oid, 'SELECT')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    )
  ORDER BY n.nspname, c.relname
  LIMIT $1`;

const COLUMNS = `
  SELECT a.attrelid AS table_oid, a.attname AS name,
         format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable
  FROM pg_attribute a
  WHERE a.attrelid = ANY($1::oid[])
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND has_column_privilege(a.attrelid, a.attnum, 'SELECT')
  ORDER BY a.attrelid, a.attnum
  LIMIT $2`;

const PRIMARY_KEYS = `
  SELECT con.conrelid AS table_oid, a.attname AS column_name
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, position)
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
  WHERE con.contype = 'p' AND con.conrelid = ANY($1::oid[])
  ORDER BY con.conrelid, k.position`;

const FOREIGN_KEYS = `
  SELECT con.oid AS constraint_oid, con.conrelid AS table_oid, con.confrelid AS ref_oid,
         a.attname AS column_name, ra.attname AS ref_column_name
  FROM pg_constraint con
  CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(attnum, ref_attnum, position)
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
  JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.ref_attnum
  WHERE con.contype = 'f' AND con.conrelid = ANY($1::oid[])
  ORDER BY con.conrelid, con.conname, con.oid, k.position`;

export type IntrospectionOutcome =
  { ok: true; document: SchemaDocument } | { ok: false; reason: 'too_large' };

export async function readSchema(
  client: PgClientLike,
  limits: IntrospectionLimits = DEFAULT_LIMITS,
): Promise<IntrospectionOutcome> {
  const relations = await client.query(RELATIONS, [limits.tables + 1]);
  if (relations.rows.length > limits.tables) {
    return { ok: false, reason: 'too_large' };
  }
  const oids = relations.rows.map((row) => Number(row.oid));
  const columns = await client.query(COLUMNS, [oids, limits.columns + 1]);
  if (columns.rows.length > limits.columns) {
    return { ok: false, reason: 'too_large' };
  }
  const primaryKeys = await client.query(PRIMARY_KEYS, [oids]);
  const foreignKeys = await client.query(FOREIGN_KEYS, [oids]);

  const byOid = new Map<number, SchemaTable>();
  for (const row of relations.rows) {
    byOid.set(Number(row.oid), {
      schema: String(row.schema),
      name: String(row.name),
      kind: KINDS[String(row.kind)] ?? 'table',
      columns: [],
      primaryKey: [],
      foreignKeys: [],
    });
  }
  for (const row of columns.rows) {
    byOid.get(Number(row.table_oid))?.columns.push({
      name: String(row.name),
      type: String(row.type),
      nullable: row.nullable === true,
    });
  }

  const keyColumns = new Map<number, string[]>();
  for (const row of primaryKeys.rows) {
    const oid = Number(row.table_oid);
    keyColumns.set(oid, [...(keyColumns.get(oid) ?? []), String(row.column_name)]);
  }
  for (const [oid, names] of keyColumns) {
    const table = byOid.get(oid);
    // A key with a column the login cannot read would name a hidden column, so drop it.
    if (table && names.every((name) => hasColumn(table, name))) {
      table.primaryKey = names;
    }
  }

  const constraints = new Map<
    number,
    { tableOid: number; refOid: number; columns: string[]; refColumns: string[] }
  >();
  for (const row of foreignKeys.rows) {
    const id = Number(row.constraint_oid);
    const entry = constraints.get(id) ?? {
      tableOid: Number(row.table_oid),
      refOid: Number(row.ref_oid),
      columns: [],
      refColumns: [],
    };
    entry.columns.push(String(row.column_name));
    entry.refColumns.push(String(row.ref_column_name));
    constraints.set(id, entry);
  }
  for (const entry of constraints.values()) {
    const table = byOid.get(entry.tableOid);
    const target = byOid.get(entry.refOid);
    // Keep a foreign key only when both ends, and every column in it, are readable.
    if (
      !table ||
      !target ||
      !entry.columns.every((name) => hasColumn(table, name)) ||
      !entry.refColumns.every((name) => hasColumn(target, name))
    ) {
      continue;
    }
    const foreignKey: SchemaForeignKey = {
      columns: entry.columns,
      references: {
        schema: target.schema,
        table: target.name,
        columns: entry.refColumns,
      },
    };
    table.foreignKeys.push(foreignKey);
  }

  return { ok: true, document: { formatVersion: 1, tables: [...byOid.values()] } };
}

function hasColumn(table: SchemaTable, name: string): boolean {
  return table.columns.some((column) => column.name === name);
}
