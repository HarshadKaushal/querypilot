import type { ProbeFailure } from './user-database.probe';

// Decisions use the SQLSTATE the server sends, Node's socket and TLS codes, and the fixed
// sentences the pg driver writes itself. Server message text is never matched: a pg_hba.conf
// rejection says "SSL encryption" even though SSL is working.

const SERVER_CODES: Record<string, string> = {
  '28P01': 'The database did not accept that username and password.',
  '28000':
    'The database refused this login. Check that pg_hba.conf has a hostssl line for the egress IP, this user, and this database, and that the role can log in.',
  '3D000': 'That database does not exist on the server. Check the database name.',
};

const REFUSED = new Set(['ECONNREFUSED']);

const NO_ANSWER = new Set(['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);

const CERTIFICATE = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// Written by the pg driver, not by the server.
const DRIVER_NO_SSL = new Set([
  'The server does not support SSL connections',
  'There was an error establishing an SSL connection',
]);
const DRIVER_TIMEOUT = 'timeout expired';

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function classifyConnectError(error: unknown): ProbeFailure {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : '';

  if (DRIVER_NO_SSL.has(message)) {
    return {
      ok: false,
      code: 'SSL_REQUIRED',
      message: 'The database did not accept an SSL connection. Enable SSL and try again.',
    };
  }
  if (code && SERVER_CODES[code]) {
    return { ok: false, code: 'CONNECTION_FAILED', message: SERVER_CODES[code] };
  }
  if (code && CERTIFICATE.has(code)) {
    return {
      ok: false,
      code: 'CONNECTION_FAILED',
      message:
        'The server certificate could not be verified. With verify-full the certificate must come from a trusted authority and match the host name.',
    };
  }
  if (code && REFUSED.has(code)) {
    return {
      ok: false,
      code: 'CONNECTION_FAILED',
      message:
        'Nothing accepted the connection at that host and port. Check the port, and that the database listens on a public address.',
    };
  }
  if ((code && NO_ANSWER.has(code)) || message === DRIVER_TIMEOUT) {
    return {
      ok: false,
      code: 'CONNECTION_FAILED',
      message:
        'The database did not answer in time. Check that its firewall allows the egress IP.',
    };
  }
  return {
    ok: false,
    code: 'CONNECTION_FAILED',
    message: 'The database connection could not be completed.',
  };
}
