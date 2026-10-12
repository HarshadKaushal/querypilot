import type { AllowlistEntry } from './allowed-schema';
import type { SchemaDocument } from './schema-document';

export interface StoredSnapshot {
  id: string;
  connectionId: string;
  version: number;
  document: SchemaDocument;
  tableCount: number;
  columnCount: number;
  createdAt: string;
}

/** Where a snapshot was read from. */
export interface DatabaseIdentity {
  host: string;
  port: number;
  databaseName: string;
}

export interface CommitSnapshotInput {
  connectionId: string;
  /**
   * The database the snapshot was read from. If the connection was edited to point
   * elsewhere while it was being read, nothing is stored.
   */
  database: DatabaseIdentity;
  document: SchemaDocument;
  tableCount: number;
  columnCount: number;
  /**
   * Runs inside the same transaction, with the previous snapshot (null on the first) and the
   * allowlist as it is now. Its result replaces the allowlist.
   */
  nextAllowlist(
    previous: SchemaDocument | null,
    current: AllowlistEntry[],
  ): AllowlistEntry[];
}

export type CommitOutcome =
  | { status: 'committed'; snapshot: StoredSnapshot; previous: SchemaDocument | null }
  | { status: 'missing' }
  | { status: 'stale' };

/** Older snapshots are deleted once a connection has more than this many. */
export const SNAPSHOTS_KEPT = 5;

// Every method takes the user id as well as the connection id and filters on both, so a
// caller that skipped the ownership check still cannot reach another user's rows.
export interface SchemaRepository {
  latestSnapshot(userId: string, connectionId: string): Promise<StoredSnapshot | null>;
  allowlist(userId: string, connectionId: string): Promise<AllowlistEntry[]>;
  /**
   * Stores the next version and replaces the allowlist. 'missing' when the connection is
   * gone, 'stale' when it now points at a different database than the snapshot came from.
   */
  commitSnapshot(userId: string, input: CommitSnapshotInput): Promise<CommitOutcome>;
  /**
   * Replaces the allowlist, but only while `version` is still the latest snapshot, checked
   * under the same lock a refresh takes.
   */
  replaceAllowlist(
    userId: string,
    connectionId: string,
    version: number,
    entries: AllowlistEntry[],
  ): Promise<'replaced' | 'stale' | 'missing'>;
  writeAudit(input: {
    userId: string;
    eventType: string;
    metadata: Record<string, string>;
    ip: string | null;
  }): Promise<void>;
}

export const SCHEMA_REPOSITORY = Symbol('SCHEMA_REPOSITORY');
