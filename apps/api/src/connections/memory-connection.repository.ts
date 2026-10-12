import type {
  ConnectionRepository,
  NewConnection,
  PublicConnection,
  StoredConnection,
} from './connection.repository';

interface AuditRow {
  userId: string | null;
  eventType: string;
  metadata: Record<string, string>;
  ip: string | null;
}

export class MemoryConnectionRepository implements ConnectionRepository {
  readonly rows: NewConnection[] = [];
  readonly audits: AuditRow[] = [];

  async insert(input: NewConnection): Promise<PublicConnection> {
    this.rows.push({ ...input });
    return toPublic(input);
  }

  async list(userId: string): Promise<PublicConnection[]> {
    return this.rows.filter((row) => row.userId === userId).map(toPublic);
  }

  async findOwned(userId: string, id: string): Promise<StoredConnection | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    return row ? toStored(row) : null;
  }

  async update(
    userId: string,
    id: string,
    patch: Partial<NewConnection>,
  ): Promise<PublicConnection | null> {
    const row = this.rows.find((item) => item.userId === userId && item.id === id);
    if (!row) {
      return null;
    }
    Object.assign(row, patch);
    return toPublic(row);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.userId === userId && row.id === id);
    if (index < 0) {
      return false;
    }
    this.rows.splice(index, 1);
    return true;
  }

  async writeAudit(input: {
    userId: string;
    eventType: string;
    metadata: Record<string, string>;
    ip: string | null;
  }): Promise<void> {
    this.audits.push({ ...input, metadata: { ...input.metadata } });
  }
}

function toPublic(row: NewConnection): PublicConnection {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    port: row.port,
    databaseName: row.databaseName,
    sslMode: row.sslMode,
    status: row.status,
    lastTestedAt: row.lastTestedAt.toISOString(),
    sendSampleRowsToLlm: row.sendSampleRowsToLlm,
    keyVersion: row.keyVersion,
  };
}

function toStored(row: NewConnection): StoredConnection {
  return { ...row, lastTestedAt: row.lastTestedAt.toISOString() };
}
