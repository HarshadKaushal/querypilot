import type { ExecutionSuccess } from '../user-database/query-executor';

type Column = ExecutionSuccess['columns'][number];

/** PostgreSQL type OIDs for numbers: int2, int4, int8, float4, float8, numeric. */
const NUMERIC_TYPES = new Set([21, 23, 20, 700, 701, 1700]);
/** date, timestamp, timestamptz. */
const TIME_TYPES = new Set([1082, 1114, 1184]);

export function isNumericColumn(column: Column): boolean {
  return NUMERIC_TYPES.has(column.dataTypeId);
}

export function isTimeColumn(column: Column): boolean {
  return TIME_TYPES.has(column.dataTypeId);
}

/** pg returns bigint and numeric as strings, so values are read as numbers here. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface NumericFact {
  column: string;
  min: number;
  max: number;
  total: number;
  average: number;
}

/**
 * Numbers the server computes from the result (blueprint 9.9). The summary model is given
 * these instead of rows unless the connection allows sample rows, and every number in a
 * summary must be one of them or appear in the rows it was shown.
 */
export interface ResultFacts {
  rowCount: number;
  truncated: ExecutionSuccess['truncated'];
  columns: string[];
  numeric: NumericFact[];
  /**
   * For one label column and one number column: the largest rows, at most 5. Labels are
   * row values, so this is empty unless the connection allows rows to reach the model.
   */
  top: Array<{ label: string; value: number }>;
}

export function computeFacts(
  result: Omit<ExecutionSuccess, 'ok' | 'durationMs'>,
  options: { labels: boolean },
): ResultFacts {
  const numeric: NumericFact[] = [];
  result.columns.forEach((column, index) => {
    if (!isNumericColumn(column)) {
      return;
    }
    const values = result.rows
      .map((row) => toNumber(row[index]))
      .filter((value): value is number => value !== null);
    if (values.length === 0) {
      return;
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    numeric.push({
      column: column.name,
      min: Math.min(...values),
      max: Math.max(...values),
      total: round(total),
      average: round(total / values.length),
    });
  });
  return {
    rowCount: result.rowCount,
    truncated: result.truncated,
    columns: result.columns.map((column) => column.name),
    numeric,
    top: options.labels ? topItems(result) : [],
  };
}

function topItems(
  result: Omit<ExecutionSuccess, 'ok' | 'durationMs'>,
): ResultFacts['top'] {
  const labelIndex = result.columns.findIndex(
    (column) => !isNumericColumn(column) && !isTimeColumn(column),
  );
  const valueIndex = result.columns.findIndex(isNumericColumn);
  if (labelIndex < 0 || valueIndex < 0 || result.columns.length !== 2) {
    return [];
  }
  return result.rows
    .map((row) => ({
      label: String(row[labelIndex] ?? ''),
      value: toNumber(row[valueIndex]),
    }))
    .filter((item): item is { label: string; value: number } => item.value !== null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

/** Two decimals: enough for a summary, and what the number check allows for. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
