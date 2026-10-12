import { classifyQueryError, countsAsConnectionFailure } from './query-error';

function pgError(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

// [case, error, expected code, retryable]
const cases: Array<[string, Error, string, boolean]> = [
  [
    'statement timeout',
    pgError('canceling statement due to statement timeout', '57014'),
    'QUERY_TIMEOUT',
    false,
  ],
  [
    'write in a read-only transaction',
    pgError('cannot execute nextval() in a read-only transaction', '25006'),
    'QUERY_WRITE_BLOCKED',
    false,
  ],
  [
    'permission denied',
    pgError('permission denied for table payroll', '42501'),
    'QUERY_NOT_PERMITTED',
    false,
  ],
  [
    'a column the snapshot has but the database dropped',
    pgError('column "nope" does not exist', '42703'),
    'QUERY_SCHEMA_CHANGED',
    false,
  ],
  [
    'a table the database dropped',
    pgError('relation "public.gone" does not exist', '42P01'),
    'QUERY_SCHEMA_CHANGED',
    false,
  ],
  [
    'a schema the database dropped',
    pgError('schema "gone" does not exist', '3F000'),
    'QUERY_SCHEMA_CHANGED',
    false,
  ],
  [
    'an operator that does not exist for the types',
    pgError('operator does not exist: text > integer', '42883'),
    'QUERY_INVALID',
    true,
  ],
  [
    'syntax error',
    pgError('syntax error at or near "FROM"', '42601'),
    'QUERY_INVALID',
    true,
  ],
  ['division by zero', pgError('division by zero', '22012'), 'QUERY_INVALID', true],
  [
    'subquery returned more than one row',
    pgError('more than one row returned by a subquery', '21000'),
    'QUERY_INVALID',
    true,
  ],
  [
    'data-modifying WITH in a cursor',
    pgError('DECLARE CURSOR must not contain data-modifying statements in WITH', '0A000'),
    'QUERY_INVALID',
    true,
  ],
  [
    'admin shutdown',
    pgError('terminating connection due to administrator command', '57P01'),
    'CONNECTION_FAILED',
    false,
  ],
  [
    'connection failure',
    pgError('server closed the connection', '08006'),
    'CONNECTION_FAILED',
    false,
  ],
  ['out of memory', pgError('out of memory', '53200'), 'CONNECTION_FAILED', false],
  [
    'other server error',
    pgError('could not serialize access', '40001'),
    'QUERY_FAILED',
    false,
  ],
  ['socket reset', pgError('read ECONNRESET', 'ECONNRESET'), 'CONNECTION_FAILED', false],
  ['driver timeout', pgError('timeout expired'), 'CONNECTION_FAILED', false],
  ['broken pipe', pgError('write EPIPE', 'EPIPE'), 'CONNECTION_FAILED', false],
  ['PL/pgSQL error class', pgError('raise exception', 'P0001'), 'QUERY_FAILED', false],
];

describe('classifyQueryError', () => {
  it.each(cases)('maps %s', (_name, error, code, retryable) => {
    expect(classifyQueryError(error, 15000)).toMatchObject({ code, retryable });
  });

  it('names the timeout in seconds', () => {
    expect(classifyQueryError(pgError('x', '57014'), 15000).message).toContain(
      '15 seconds',
    );
  });

  it('never returns the database text', () => {
    const result = classifyQueryError(
      pgError('column "secret_salary" does not exist', '42703'),
      15000,
    );
    expect(JSON.stringify(result)).not.toContain('secret_salary');
  });

  it('counts only connection trouble and timeouts toward pausing a connection', () => {
    expect(countsAsConnectionFailure('CONNECTION_FAILED')).toBe(true);
    expect(countsAsConnectionFailure('QUERY_TIMEOUT')).toBe(true);
    expect(countsAsConnectionFailure('QUERY_INVALID')).toBe(false);
    expect(countsAsConnectionFailure('QUERY_WRITE_BLOCKED')).toBe(false);
  });
});
