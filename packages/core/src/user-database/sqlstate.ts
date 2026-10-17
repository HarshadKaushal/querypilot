// The PostgreSQL error codes (SQLSTATE) this package makes decisions on. The server sends
// one with every error; the full list is in the PostgreSQL manual, appendix A. Deciding on
// the code, never the message text, keeps the decision the same in every server language.
export const SQLSTATE = {
  /** statement_timeout fired, or the query was cancelled. */
  QUERY_CANCELED: '57014',
  /** A write inside a READ ONLY transaction. */
  READ_ONLY_SQL_TRANSACTION: '25006',
  /** The login lacks a privilege on a table or column. */
  INSUFFICIENT_PRIVILEGE: '42501',
  UNDEFINED_COLUMN: '42703',
  UNDEFINED_TABLE: '42P01',
  INVALID_SCHEMA_NAME: '3F000',
} as const;
