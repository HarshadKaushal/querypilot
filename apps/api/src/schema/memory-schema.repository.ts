import type { AllowlistEntry } from './allowed-schema';
import {
  SNAPSHOTS_KEPT,
  type CommitOutcome,
  type CommitSnapshotInput,
  type DatabaseIdentity,
  type SchemaRepository,
  type StoredSnapshot,
} from './schema.repository';

interface AuditRow {
  userId: string;
  eventType: string;
  metadata: Record<string, string>;
  ip: string | null;
}

// In-memory stand-in for unit tests. `owners` plays the part of connections.user_id.
export class MemorySchemaRepository implements SchemaRepository {
  readonly owners = new Map<string, string>();
  /** Plays the part of each connection's host, port, and database name, when set. */
  readonly databases = new Map<string, DatabaseIdentity>();
  readonly snapshots: StoredSnapshot[] = [];
  readonly allowed = new Map<string, AllowlistEntry[]>();
  readonly audits: AuditRow[] = [];

  async latestSnapshot(
    userId: string,
    connectionId: string,
  ): Promise<StoredSnapshot | null> {
    if (this.owners.get(connectionId) !== userId) {
      return null;
    }
    const versions = this.snapshots.filter((item) => item.connectionId === connectionId);
    return versions.sort((a, b) => b.version - a.version)[0] ?? null;
  }

  async allowlist(userId: string, connectionId: string): Promise<AllowlistEntry[]> {
    if (this.owners.get(connectionId) !== userId) {
      return [];
    }
    return [...(this.allowed.get(connectionId) ?? [])];
  }

  async commitSnapshot(
    userId: string,
    input: CommitSnapshotInput,
  ): Promise<CommitOutcome> {
    if (this.owners.get(input.connectionId) !== userId) {
      return { status: 'missing' };
    }
    const current = this.databases.get(input.connectionId);
    if (current && JSON.stringify(current) !== JSON.stringify(input.database)) {
      return { status: 'stale' };
    }
    const previous = await this.latestSnapshot(userId, input.connectionId);
    const snapshot: StoredSnapshot = {
      id: `snapshot-${this.snapshots.length + 1}`,
      connectionId: input.connectionId,
      version: (previous?.version ?? 0) + 1,
      document: input.document,
      tableCount: input.tableCount,
      columnCount: input.columnCount,
      createdAt: new Date().toISOString(),
    };
    this.snapshots.push(snapshot);
    this.allowed.set(
      input.connectionId,
      input.nextAllowlist(
        previous?.document ?? null,
        this.allowed.get(input.connectionId) ?? [],
      ),
    );
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const item = this.snapshots[i]!;
      if (
        item.connectionId === input.connectionId &&
        item.version <= snapshot.version - SNAPSHOTS_KEPT
      ) {
        this.snapshots.splice(i, 1);
      }
    }
    return { status: 'committed', snapshot, previous: previous?.document ?? null };
  }

  async replaceAllowlist(
    userId: string,
    connectionId: string,
    version: number,
    entries: AllowlistEntry[],
  ): Promise<'replaced' | 'stale' | 'missing'> {
    if (this.owners.get(connectionId) !== userId) {
      return 'missing';
    }
    const latest = await this.latestSnapshot(userId, connectionId);
    if (latest?.version !== version) {
      return 'stale';
    }
    this.allowed.set(connectionId, [...entries]);
    return 'replaced';
  }

  async writeAudit(input: AuditRow): Promise<void> {
    this.audits.push({ ...input, metadata: { ...input.metadata } });
  }
}
