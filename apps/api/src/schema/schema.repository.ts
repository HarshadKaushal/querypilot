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

export interface CommitSnapshotInput {
  connectionId: string;
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

/** Older snapshots are deleted once a connection has more than this many. */
export const SNAPSHOTS_KEPT = 5;

// Every method takes the user id as well as the connection id and filters on both, so a
// caller that skipped the ownership check still cannot reach another user's rows.
export interface SchemaRepository {
  latestSnapshot(userId: string, connectionId: string): Promise<StoredSnapshot | null>;
  allowlist(userId: string, connectionId: string): Promise<AllowlistEntry[]>;
  /** Stores the next version and replaces the allowlist. Null when the connection is gone. */
  commitSnapshot(
    userId: string,
    input: CommitSnapshotInput,
  ): Promise<{ snapshot: StoredSnapshot; previous: SchemaDocument | null } | null>;
  writeAudit(input: {
    userId: string;
    eventType: string;
    metadata: Record<string, string>;
    ip: string | null;
  }): Promise<void>;
}

export const SCHEMA_REPOSITORY = Symbol('SCHEMA_REPOSITORY');
