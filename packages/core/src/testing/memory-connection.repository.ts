import type { AuditEntry } from '../audit/audit-log';
import {
  toPublicConnection,
  type ConnectionRepository,
  type NewConnection,
  type PublicConnection,
  type StoredConnection,
} from '../connections/connection.repository';

export class MemoryConnectionRepository implements ConnectionRepository {
  readonly rows: NewConnection[] = [];
  readonly audits: AuditEntry[] = [];
  /** Connection ids whose schema an update asked to delete. */
  readonly schemaResets: string[] = [];

  async insert(input: NewConnection): Promise<PublicConnection> {
    this.rows.push({ ...input });
    return toPublicConnection(input);
  }

  async list(userId: string): Promise<PublicConnection[]> {
    return this.rows.filter((row) => row.userId === userId).map(toPublicConnection);
  }

  async findOwned(userId: string, id: string): Promise<StoredConnection | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    return row ? toStored(row) : null;
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<NewConnection>,
    options: { resetSchema?: boolean } = {},
  ): Promise<PublicConnection | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    if (!row) {
      return null;
    }
    Object.assign(row, patch);
    if (options.resetSchema) {
      this.schemaResets.push(id);
    }
    return toPublicConnection(row);
  }

  async delete(userId: string, id: string, ip: string | null): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.userId === userId && row.id === id);
    if (index < 0) {
      return false;
    }
    this.rows.splice(index, 1);
    // Audited with the delete, as the Prisma repository does in one transaction.
    await this.writeAudit({
      userId,
      eventType: 'connection.deleted',
      metadata: { connectionId: id },
      ip,
    });
    return true;
  }

  async writeAudit(entry: AuditEntry): Promise<void> {
    this.audits.push({ ...entry, metadata: { ...entry.metadata } });
  }
}

function toStored(row: NewConnection): StoredConnection {
  return { ...row, lastTestedAt: row.lastTestedAt.toISOString() };
}
