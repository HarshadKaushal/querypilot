import { classifyConnectError } from './connect-error';

function failure(message: string, code?: string): Error {
  return Object.assign(new Error(message), code ? { code } : {});
}

// [case, thrown error, expected code, text the message must contain]
const cases: Array<[string, unknown, string, string]> = [
  [
    'pg_hba.conf rejection over SSL',
    failure(
      'no pg_hba.conf entry for host "x", user "y", database "z", SSL encryption',
      '28000',
    ),
    'CONNECTION_FAILED',
    'pg_hba.conf',
  ],
  [
    'pg_hba.conf rejection, pre-14 wording',
    failure('no pg_hba.conf entry for host "x", user "y", database "z", SSL on', '28000'),
    'CONNECTION_FAILED',
    'hostssl',
  ],
  [
    'wrong password',
    failure('password authentication failed for user "y"', '28P01'),
    'CONNECTION_FAILED',
    'username and password',
  ],
  [
    'unknown database',
    failure('database "z" does not exist', '3D000'),
    'CONNECTION_FAILED',
    'does not exist',
  ],
  [
    'server without SSL',
    failure('The server does not support SSL connections'),
    'SSL_REQUIRED',
    'SSL',
  ],
  [
    'server error during SSL negotiation',
    failure('There was an error establishing an SSL connection'),
    'SSL_REQUIRED',
    'SSL',
  ],
  [
    'self-signed certificate with verify-full',
    failure('self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'),
    'CONNECTION_FAILED',
    'certificate',
  ],
  [
    'certificate for another host name',
    failure(
      "Hostname/IP does not match certificate's altnames",
      'ERR_TLS_CERT_ALTNAME_INVALID',
    ),
    'CONNECTION_FAILED',
    'certificate',
  ],
  [
    'port closed',
    failure('connect ECONNREFUSED 192.0.2.1:5432', 'ECONNREFUSED'),
    'CONNECTION_FAILED',
    'port',
  ],
  ['driver connect timeout', failure('timeout expired'), 'CONNECTION_FAILED', 'firewall'],
  [
    'socket timeout',
    failure('connect ETIMEDOUT 192.0.2.1:5432', 'ETIMEDOUT'),
    'CONNECTION_FAILED',
    'firewall',
  ],
  [
    'unreachable host',
    failure('connect EHOSTUNREACH', 'EHOSTUNREACH'),
    'CONNECTION_FAILED',
    'firewall',
  ],
  [
    'server text that mentions SSL with no code',
    failure('ssl is mentioned here but this is not a driver message'),
    'CONNECTION_FAILED',
    'could not be completed',
  ],
  ['a thrown string', 'boom', 'CONNECTION_FAILED', 'could not be completed'],
];

describe('classifyConnectError', () => {
  it.each(cases)('maps %s', (_name, error, code, fragment) => {
    const result = classifyConnectError(error);
    expect(result.code).toBe(code);
    expect(result.message).toContain(fragment);
  });

  it('never returns the driver or server text', () => {
    const secret = failure(
      'password authentication failed for user "secret_user" postgres://u:secret@db/x',
      '28P01',
    );
    expect(JSON.stringify(classifyConnectError(secret))).not.toContain('secret');
  });
});
