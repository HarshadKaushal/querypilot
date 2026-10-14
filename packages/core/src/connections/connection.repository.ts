import type { SealedCredentials } from '@ayd/crypto';
import type { AuditEntry } from '../audit/audit-log';

export interface PublicConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: string;
  lastTestedAt: string | null;
  sendSampleRowsToLlm: boolean;
  keyVersion: number;
}

export interface StoredConnection extends PublicConnection, SealedCredentials {
  userId: string;
}

export interface NewConnection extends SealedCredentials {
  id: string;
  userId: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: string;
  lastTestedAt: Date;
  sendSampleRowsToLlm: boolean;
}

export interface ConnectionRepository {
  insert(input: NewConnection): Promise<PublicConnection>;
  list(userId: string): Promise<PublicConnection[]>;
  findOwned(userId: string, id: string): Promise<StoredConnection | null>;
  update(
    userId: string,
    id: string,
    patch: Partial<NewConnection> & { status?: string; lastTestedAt?: Date | null },
    options?: {
      /** Also delete the schema snapshots and allowlist, in the same transaction. */
      resetSchema?: boolean;
    },
  ): Promise<PublicConnection | null>;
  /**
   * Deletes the connection and writes its `connection.deleted` audit row in one
   * transaction. False, and no audit row, when there was nothing of this user's to delete.
   */
  delete(userId: string, id: string, ip: string | null): Promise<boolean>;
  writeAudit(entry: AuditEntry): Promise<void>;
}

export const CONNECTION_REPOSITORY = Symbol('CONNECTION_REPOSITORY');

/**
 * Picks the fields a client may see. Everything else on a stored connection, the sealed
 * credentials above all, is left behind. Accepts a Date or ISO string for lastTestedAt.
 */
export function toPublicConnection(row: {
  id: string;
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: string;
  status: string;
  lastTestedAt: Date | string | null;
  sendSampleRowsToLlm: boolean;
  keyVersion: number;
}): PublicConnection {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    sslMode: row.sslMode,
    status: row.status,
    lastTestedAt:
      row.lastTestedAt instanceof Date
        ? row.lastTestedAt.toISOString()
        : row.lastTestedAt,
    sendSampleRowsToLlm: row.sendSampleRowsToLlm,
    keyVersion: row.keyVersion,
  };
}
