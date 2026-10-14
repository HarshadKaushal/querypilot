export const ERROR_CODES = [
  'INTERNAL_ERROR',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'DEPENDENCY_UNAVAILABLE',
  'UNAUTHENTICATED',
  'AUTH_FAILED',
  'AUTH_NOT_CONFIGURED',
  'SSRF_BLOCKED',
  'SSL_REQUIRED',
  'NOT_READ_ONLY',
  'CONNECTION_FAILED',
  'SCHEMA_TOO_LARGE',
  'SCHEMA_NOT_READY',
  'SCHEMA_CHANGED',
  'CONNECTION_BUSY',
  'CONNECTION_PAUSED',
  'QUERY_TIMEOUT',
  'QUERY_WRITE_BLOCKED',
  'QUERY_NOT_PERMITTED',
  'QUERY_INVALID',
  'QUERY_SCHEMA_CHANGED',
  'QUERY_FAILED',
  'SQL_REJECTED',
  'JOB_CANCELLED',
  'TOO_MANY_JOBS',
  'LLM_NOT_CONFIGURED',
  'LLM_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      requestId,
    },
  };
}
