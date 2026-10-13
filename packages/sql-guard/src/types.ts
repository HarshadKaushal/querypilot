export interface GuardColumn {
  name: string;
  allowed: boolean;
}

/**
 * One table from the schema snapshot. Pass every table, allowed or not, with every column:
 * the guard needs hidden columns to resolve names exactly the way PostgreSQL does.
 */
export interface GuardTable {
  schema: string;
  name: string;
  allowed: boolean;
  columns: GuardColumn[];
}

export interface GuardOptions {
  tables: GuardTable[];
  /**
   * The most rows the caller returns. A larger or missing LIMIT becomes rowCap + 1, so the
   * caller can tell a cut result (rowCap + 1 rows came back) from a complete one.
   */
  rowCap: number;
}

export type RejectionCode =
  | 'empty'
  | 'too_long'
  | 'too_complex'
  | 'parse_error'
  | 'multiple_statements'
  | 'not_select'
  | 'writes_data'
  | 'locking_clause'
  | 'recursive_query'
  | 'table_not_allowed'
  | 'column_not_allowed'
  | 'ambiguous_reference'
  | 'function_not_allowed'
  | 'type_not_allowed'
  | 'unsupported_syntax'
  | 'verification_failed';

export type GuardVerdict =
  | {
      ok: true;
      /** The SQL to run: fully qualified names, hidden columns never listed, LIMIT capped. */
      sql: string;
      /** True when the guard added a LIMIT or lowered one to rowCap + 1. */
      limitApplied: boolean;
    }
  | { ok: false; code: RejectionCode; reason: string };
