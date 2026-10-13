import { createHash } from 'node:crypto';
import type {
  RelationKind,
  SchemaColumn,
  SchemaDocument,
  SchemaForeignKey,
  SchemaTable,
} from './schema-document';
import { isSensitiveColumn } from './sensitive-columns';

// Pure functions over a snapshot and its allowlist. Every schema the model will see is built
// by allowedSchema(), so the allowlist is enforced in one place (ADR 0008).

/** One allowed_objects row. A null columnName allows the table itself. */
export interface AllowlistEntry {
  schemaName: string;
  tableName: string;
  columnName: string | null;
  description: string | null;
}

export interface AllowedColumn extends SchemaColumn {
  description: string | null;
}

export interface AllowedTable {
  schema: string;
  name: string;
  kind: RelationKind;
  description: string | null;
  columns: AllowedColumn[];
  primaryKey: string[];
  foreignKeys: SchemaForeignKey[];
}

export interface AllowlistTableView {
  schema: string;
  name: string;
  kind: RelationKind;
  allowed: boolean;
  description: string | null;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    allowed: boolean;
    sensitive: boolean;
    description: string | null;
  }>;
}

function key(schema: string, table: string, column: string | null = null): string {
  return JSON.stringify([schema, table, column]);
}

function index(entries: AllowlistEntry[]): Map<string, AllowlistEntry> {
  return new Map(
    entries.map((entry) => [
      key(entry.schemaName, entry.tableName, entry.columnName),
      entry,
    ]),
  );
}

/** First snapshot only: every table, and every column the sensitive hint does not flag. */
export function defaultAllowlist(document: SchemaDocument): AllowlistEntry[] {
  const entries: AllowlistEntry[] = [];
  for (const table of document.tables) {
    entries.push({
      schemaName: table.schema,
      tableName: table.name,
      columnName: null,
      description: null,
    });
    for (const column of table.columns) {
      if (!isSensitiveColumn(column.name, column.type)) {
        entries.push({
          schemaName: table.schema,
          tableName: table.name,
          columnName: column.name,
          description: null,
        });
      }
    }
  }
  return entries;
}

/** Later snapshots: keep entries whose object still exists. New objects stay hidden. */
export function reconcileAllowlist(
  entries: AllowlistEntry[],
  document: SchemaDocument,
): AllowlistEntry[] {
  const present = new Set<string>();
  for (const table of document.tables) {
    present.add(key(table.schema, table.name));
    for (const column of table.columns) {
      present.add(key(table.schema, table.name, column.name));
    }
  }
  return entries.filter((entry) =>
    present.has(key(entry.schemaName, entry.tableName, entry.columnName)),
  );
}

/** Tables and columns in `next` that `previous` did not have, as dotted names. */
export function newObjects(
  previous: SchemaDocument,
  next: SchemaDocument,
): { tables: string[]; columns: string[] } {
  const before = new Map(
    previous.tables.map((table) => [key(table.schema, table.name), table]),
  );
  const tables: string[] = [];
  const columns: string[] = [];
  for (const table of next.tables) {
    const old = before.get(key(table.schema, table.name));
    if (!old) {
      tables.push(`${table.schema}.${table.name}`);
      continue;
    }
    const oldColumns = new Set(old.columns.map((column) => column.name));
    for (const column of table.columns) {
      if (!oldColumns.has(column.name)) {
        columns.push(`${table.schema}.${table.name}.${column.name}`);
      }
    }
  }
  return { tables, columns };
}

/**
 * The schema the model may see: allowed tables, and within them allowed columns. A key is
 * kept only when every column it names is visible, so a hidden column name never leaks
 * through a primary or foreign key.
 */
export function allowedSchema(
  document: SchemaDocument,
  entries: AllowlistEntry[],
): AllowedTable[] {
  const allowed = index(entries);
  const tables: AllowedTable[] = [];
  for (const table of document.tables) {
    const tableEntry = allowed.get(key(table.schema, table.name));
    if (!tableEntry) {
      continue;
    }
    const columns = table.columns.flatMap((column) => {
      const entry = allowed.get(key(table.schema, table.name, column.name));
      return entry ? [{ ...column, description: entry.description }] : [];
    });
    tables.push({
      schema: table.schema,
      name: table.name,
      kind: table.kind,
      description: tableEntry.description,
      columns,
      primaryKey: [],
      foreignKeys: [],
    });
  }

  const visible = new Map(tables.map((table) => [key(table.schema, table.name), table]));
  const shows = (table: AllowedTable | undefined, names: string[]) =>
    !!table &&
    names.every((name) => table.columns.some((column) => column.name === name));
  for (const table of document.tables) {
    const out = visible.get(key(table.schema, table.name));
    if (!out) {
      continue;
    }
    if (table.primaryKey.length > 0 && shows(out, table.primaryKey)) {
      out.primaryKey = table.primaryKey;
    }
    out.foreignKeys = table.foreignKeys.filter(
      (foreignKey) =>
        shows(out, foreignKey.columns) &&
        shows(
          visible.get(key(foreignKey.references.schema, foreignKey.references.table)),
          foreignKey.references.columns,
        ),
    );
  }
  return tables;
}

/**
 * Changes whenever the snapshot version or anything the model would see changes. The SQL
 * proposal cache keys on it, so a refresh or an allowlist edit invalidates cached proposals.
 */
export function schemaFingerprint(version: number, tables: AllowedTable[]): string {
  return createHash('sha256').update(JSON.stringify({ version, tables })).digest('hex');
}

/** Every object in the snapshot with its allowlist state, for the allowlist editor. */
export function allowlistView(
  document: SchemaDocument,
  entries: AllowlistEntry[],
): AllowlistTableView[] {
  const allowed = index(entries);
  return document.tables.map((table: SchemaTable) => {
    const tableEntry = allowed.get(key(table.schema, table.name));
    return {
      schema: table.schema,
      name: table.name,
      kind: table.kind,
      allowed: !!tableEntry,
      description: tableEntry?.description ?? null,
      columns: table.columns.map((column) => {
        const entry = allowed.get(key(table.schema, table.name, column.name));
        return {
          name: column.name,
          type: column.type,
          nullable: column.nullable,
          allowed: !!entry,
          sensitive: isSensitiveColumn(column.name, column.type),
          description: entry?.description ?? null,
        };
      }),
    };
  });
}
