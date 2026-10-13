import type { AllowlistEntry } from './allowed-schema';
import type { SchemaDocument } from './schema-document';

// Turns the body of PUT /v1/connections/:id/allowlist into allowlist rows. Columns are nested
// under their table, so a column can never be allowed without its table. Every name has to
// exist in the snapshot the user edited.

export const DESCRIPTION_MAX = 500;

// Matching control characters is the point here.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export type AllowlistInputResult =
  | { ok: true; version: number; entries: AllowlistEntry[] }
  | { ok: false; reason: 'invalid' | 'unknown_object' };

export function parseAllowlistInput(
  body: unknown,
  document: SchemaDocument,
): AllowlistInputResult {
  if (!isRecord(body) || !Number.isInteger(body.version) || !Array.isArray(body.tables)) {
    return { ok: false, reason: 'invalid' };
  }
  const tables = new Map(
    document.tables.map((table) => [`${table.schema}.${table.name}`, table]),
  );
  const seen = new Set<string>();
  const entries: AllowlistEntry[] = [];

  for (const item of body.tables) {
    if (
      !isRecord(item) ||
      typeof item.schema !== 'string' ||
      typeof item.name !== 'string' ||
      (item.columns !== undefined && !Array.isArray(item.columns))
    ) {
      return { ok: false, reason: 'invalid' };
    }
    const tableKey = JSON.stringify([item.schema, item.name]);
    const description = cleanDescription(item.description);
    if (seen.has(tableKey) || description === undefined) {
      return { ok: false, reason: 'invalid' };
    }
    seen.add(tableKey);
    const table = tables.get(`${item.schema}.${item.name}`);
    if (!table) {
      return { ok: false, reason: 'unknown_object' };
    }
    entries.push({
      schemaName: table.schema,
      tableName: table.name,
      columnName: null,
      description,
    });

    for (const column of (item.columns as unknown[] | undefined) ?? []) {
      if (!isRecord(column) || typeof column.name !== 'string') {
        return { ok: false, reason: 'invalid' };
      }
      const columnKey = JSON.stringify([item.schema, item.name, column.name]);
      const columnDescription = cleanDescription(column.description);
      if (seen.has(columnKey) || columnDescription === undefined) {
        return { ok: false, reason: 'invalid' };
      }
      seen.add(columnKey);
      if (!table.columns.some((known) => known.name === column.name)) {
        return { ok: false, reason: 'unknown_object' };
      }
      entries.push({
        schemaName: table.schema,
        tableName: table.name,
        columnName: column.name,
        description: columnDescription,
      });
    }
  }
  return { ok: true, version: body.version as number, entries };
}

/**
 * Descriptions reach the model later, so whitespace is collapsed and control characters are
 * removed. Returns null for no description and undefined when the value is not acceptable.
 */
export function cleanDescription(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/\s+/g, ' ').replace(CONTROL_CHARACTERS, '').trim();
  if (cleaned.length > DESCRIPTION_MAX) {
    return undefined;
  }
  return cleaned.length > 0 ? cleaned : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
