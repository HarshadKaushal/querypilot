import { classifyConnectError, errorCode } from './connect-error';

export type ExecutionFailureCode =
  | 'CONNECTION_FAILED'
  | 'SSL_REQUIRED'
  | 'CONNECTION_BUSY'
  | 'CONNECTION_PAUSED'
  | 'QUERY_TIMEOUT'
  | 'QUERY_WRITE_BLOCKED'
  | 'QUERY_NOT_PERMITTED'
  | 'QUERY_INVALID'
  | 'QUERY_SCHEMA_CHANGED'
  | 'QUERY_FAILED';

export interface ExecutionFailure {
  ok: false;
  code: ExecutionFailureCode;
  /** Written here, never copied from the database. */
  message: string;
  /** True when a corrected query could succeed, so the model may try once more. */
  retryable: boolean;
}

/** Errors that mean the database itself is in trouble, which count toward pausing it. */
export function countsAsConnectionFailure(code: ExecutionFailureCode): boolean {
  return (
    code === 'CONNECTION_FAILED' || code === 'SSL_REQUIRED' || code === 'QUERY_TIMEOUT'
  );
}

export function failure(
  code: ExecutionFailureCode,
  message: string,
  retryable = false,
): ExecutionFailure {
  return { ok: false, code, message, retryable };
}

/** Maps an error raised while a query ran. Decides from the SQLSTATE, never the text. */
export function classifyQueryError(error: unknown, timeoutMs: number): ExecutionFailure {
  const code = errorCode(error);
  // A SQLSTATE class is a digit and a digit or letter (42, 0A), or F0, HV, P0, or XX.
  // Node codes such as EPIPE are not.
  if (code === undefined || !/^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(code)) {
    // Not from the server: the socket or TLS failed mid-query.
    const connect = classifyConnectError(error);
    return failure(
      connect.code === 'NOT_READ_ONLY' ? 'QUERY_FAILED' : connect.code,
      connect.message,
    );
  }
  if (code === '57014') {
    return failure(
      'QUERY_TIMEOUT',
      `The query ran longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped. Try a narrower question.`,
    );
  }
  if (code === '25006') {
    return failure(
      'QUERY_WRITE_BLOCKED',
      'The query tried to change data, which is never allowed.',
    );
  }
  if (code === '42501') {
    return failure(
      'QUERY_NOT_PERMITTED',
      'The database login is not allowed to read part of this query.',
    );
  }
  // The guard checked names against the saved snapshot, so a column, table, or schema the
  // database no longer has means its structure changed since the last refresh. Retrying
  // with the same snapshot would fail the same way.
  if (code === '42703' || code === '42P01' || code === '3F000') {
    return failure(
      'QUERY_SCHEMA_CHANGED',
      "Your database's structure has changed since its schema was last read. Refresh the schema and ask again.",
    );
  }
  // Syntax and naming (42), data (22), cardinality (21), and unsupported features (0A) are
  // mistakes in the query itself, which a corrected query can avoid.
  if (/^(42|22|21|0A)/.test(code)) {
    return failure(
      'QUERY_INVALID',
      'The database could not run this query as written.',
      true,
    );
  }
  // Connection exceptions (08), shutdown (57P), and resource limits (53).
  if (/^(08|57P|53)/.test(code)) {
    return failure(
      'CONNECTION_FAILED',
      'The connection to the database was lost during the query.',
    );
  }
  return failure('QUERY_FAILED', 'The query could not be completed.');
}
