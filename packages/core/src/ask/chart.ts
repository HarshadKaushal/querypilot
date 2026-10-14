import type { ExecutionSuccess } from '../user-database/query-executor';
import { isNumericColumn, isTimeColumn, toNumber } from './facts';

/** At most this many points are sent for a chart (blueprint 9.8: downsample). */
export const MAX_CHART_POINTS = 200;

export type ChartType = 'stat' | 'line' | 'bar' | 'pie' | 'table';

/** How to draw the result. The table view is always available besides the chart. */
export interface ChartSpec {
  type: ChartType;
  /** The column on the x axis, or the label of a stat card. */
  x?: string;
  /** The value columns. */
  y?: string[];
  /** The rows to plot, in column order: all of them, or a thinned set for a long line. */
  points?: unknown[][];
  /** True when points is a thinned subset of the rows. */
  downsampled?: boolean;
}

/**
 * Picks a chart from column types and row counts only (blueprint 9.8), so the same result
 * always gets the same chart and no model is involved:
 * - one row with one number: a stat card;
 * - a date or timestamp column then numbers: a line;
 * - one label and one number, 2 to 5 rows, none negative: a pie (a small share of total);
 * - one label and one or more numbers, up to 50 rows: bars;
 * - anything else: the table.
 */
export function selectChart(
  result: Pick<ExecutionSuccess, 'columns' | 'rows'>,
): ChartSpec {
  const { columns, rows } = result;
  if (rows.length === 0) {
    return { type: 'table' };
  }
  const numbers = columns.filter(isNumericColumn);
  if (rows.length === 1 && columns.length === 1 && numbers.length === 1) {
    return { type: 'stat', x: columns[0]!.name, y: [columns[0]!.name], points: rows };
  }
  const [first, ...rest] = columns;
  if (!first || rest.length === 0 || !rest.every(isNumericColumn)) {
    return { type: 'table' };
  }
  const y = rest.map((column) => column.name);
  if (isTimeColumn(first)) {
    const thinned = downsample(rows);
    return {
      type: 'line',
      x: first.name,
      y,
      points: thinned,
      ...(thinned.length < rows.length ? { downsampled: true } : {}),
    };
  }
  if (isNumericColumn(first)) {
    return { type: 'table' };
  }
  if (
    rest.length === 1 &&
    rows.length >= 2 &&
    rows.length <= 5 &&
    rows.every((row) => (toNumber(row[1]) ?? -1) >= 0)
  ) {
    return { type: 'pie', x: first.name, y, points: rows };
  }
  if (rows.length <= 50) {
    return { type: 'bar', x: first.name, y, points: rows };
  }
  return { type: 'table' };
}

/** Every k-th row, keeping the first and the last, so the line keeps its shape and ends. */
export function downsample(rows: unknown[][], max = MAX_CHART_POINTS): unknown[][] {
  if (rows.length <= max) {
    return rows;
  }
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]!);
}
