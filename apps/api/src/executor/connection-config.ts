import { isIP } from 'node:net';
import type { ClientConfig } from 'pg';
import type { ProbeRequest } from './user-database.probe';

/**
 * How every socket to a user database is opened: to the address the SSRF guard pinned,
 * always over TLS, with the host name kept for certificate checks. Shared by the probe and
 * the executor's pools so the two cannot drift apart.
 */
export function userDatabaseConfig(request: ProbeRequest): ClientConfig {
  return {
    host: request.hostIp,
    port: request.port,
    database: request.database,
    user: request.username,
    password: request.password,
    connectionTimeoutMillis: 5000,
    ssl: {
      rejectUnauthorized: request.sslMode === 'verify-full',
      // The TLS server name (SNI) must be a host name, never an IP (RFC 6066). When the
      // user entered an IP, leave it unset: the certificate is then checked against that
      // IP, which is what pg does by default.
      ...(isIP(request.servername) ? {} : { servername: request.servername }),
    },
  };
}
