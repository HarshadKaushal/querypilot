/** A number from a cell: PostgreSQL sends bigint and numeric as strings. Null if not one. */
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

/** How a cell is shown in the table. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Sorts rows by one column: numbers by value, everything else as text; empty cells last. */
export function sortRows(rows: unknown[][], index: number, direction: 'asc' | 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[index];
    const right = b[index];
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    const l = toNumber(left);
    const r = toNumber(right);
    if (l !== null && r !== null) {
      return (l - r) * sign;
    }
    return formatCell(left).localeCompare(formatCell(right)) * sign;
  });
}
