import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ConnectionService, probeError } from '../connections/connection.service';
import { UserDatabaseProbe } from '../executor/user-database.probe';
import {
  allowedSchema,
  allowlistView,
  defaultAllowlist,
  newObjects,
  reconcileAllowlist,
  schemaFingerprint,
  type AllowedTable,
  type AllowlistTableView,
} from './allowed-schema';
import { parseAllowlistInput } from './allowlist-input';
import {
  SCHEMA_REPOSITORY,
  type SchemaRepository,
  type StoredSnapshot,
} from './schema.repository';

export interface RefreshSummary {
  connectionId: string;
  version: number;
  createdAt: string;
  tableCount: number;
  columnCount: number;
  /** True on the first snapshot, when the default allowlist was applied. */
  defaultsApplied: boolean;
  /** Objects this refresh found that the previous snapshot did not have. They start hidden. */
  newObjects: { tables: string[]; columns: string[] };
}

export interface SchemaView {
  connectionId: string;
  version: number;
  createdAt: string;
  fingerprint: string;
  tables: AllowedTable[];
}

export interface AllowlistView {
  connectionId: string;
  version: number;
  createdAt: string;
  tables: AllowlistTableView[];
}

const NOT_READY = new AppException(
  'SCHEMA_NOT_READY',
  'The schema for this connection has not been read yet. Refresh the schema first.',
  HttpStatus.CONFLICT,
);

const CHANGED = new AppException(
  'SCHEMA_CHANGED',
  'The schema was refreshed after this allowlist was loaded. Reload the allowlist and try again.',
  HttpStatus.CONFLICT,
);

const NOT_FOUND = new AppException(
  'NOT_FOUND',
  'That resource was not found.',
  HttpStatus.NOT_FOUND,
);

@Injectable()
export class SchemaService {
  constructor(
    @Inject(SCHEMA_REPOSITORY) private readonly repo: SchemaRepository,
    private readonly connections: ConnectionService,
    private readonly probe: UserDatabaseProbe,
  ) {}

  async refresh(
    userId: string,
    connectionId: string,
    ip: string | null,
  ): Promise<RefreshSummary> {
    const target = await this.connections.resolveTarget(userId, connectionId);
    if (!target.ok) {
      await this.connections.recordTest(userId, connectionId, false);
      await this.audit(userId, connectionId, ip, { result: 'failed' });
      throw target.error;
    }
    const result = await this.probe.introspect(target.request);
    if (!result.ok) {
      // Too large means the connection works; anything else means it does not.
      if (result.code !== 'SCHEMA_TOO_LARGE') {
        await this.connections.recordTest(userId, connectionId, false);
      }
      await this.audit(userId, connectionId, ip, { result: 'failed' });
      throw result.code === 'SCHEMA_TOO_LARGE'
        ? new AppException(result.code, result.message, HttpStatus.UNPROCESSABLE_ENTITY)
        : probeError(result);
    }

    const { document } = result;
    const committed = await this.repo.commitSnapshot(userId, {
      connectionId,
      database: {
        host: target.row.host,
        port: target.row.port,
        databaseName: target.row.databaseName,
      },
      document,
      tableCount: document.tables.length,
      columnCount: document.tables.reduce((sum, table) => sum + table.columns.length, 0),
      nextAllowlist: (previous, current) =>
        previous ? reconcileAllowlist(current, document) : defaultAllowlist(document),
    });
    if (committed.status === 'missing') {
      throw NOT_FOUND;
    }
    if (committed.status === 'stale') {
      throw new AppException(
        'SCHEMA_CHANGED',
        'The connection was changed to another database while its schema was being read. Refresh the schema again.',
        HttpStatus.CONFLICT,
      );
    }
    await this.connections.recordTest(userId, connectionId, true);
    const { snapshot, previous } = committed;
    await this.audit(userId, connectionId, ip, {
      result: 'ok',
      version: String(snapshot.version),
    });
    return {
      connectionId,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      tableCount: snapshot.tableCount,
      columnCount: snapshot.columnCount,
      defaultsApplied: previous === null,
      newObjects: previous ? newObjects(previous, document) : { tables: [], columns: [] },
    };
  }

  /** The allowlisted schema: what the model is allowed to see. */
  async schema(userId: string, connectionId: string): Promise<SchemaView> {
    const snapshot = await this.latest(userId, connectionId);
    const tables = allowedSchema(
      snapshot.document,
      await this.repo.allowlist(userId, connectionId),
    );
    return {
      connectionId,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      fingerprint: schemaFingerprint(snapshot.version, tables),
      tables,
    };
  }

  /** Every object in the latest snapshot with its allowlist state, for the editor. */
  async allowlist(userId: string, connectionId: string): Promise<AllowlistView> {
    const snapshot = await this.latest(userId, connectionId);
    return {
      connectionId,
      version: snapshot.version,
      createdAt: snapshot.createdAt,
      tables: allowlistView(
        snapshot.document,
        await this.repo.allowlist(userId, connectionId),
      ),
    };
  }

  /**
   * Saves the allowed tables, columns, and descriptions. The body names the snapshot version
   * it was edited against; if a refresh has happened since, nothing is saved.
   */
  async updateAllowlist(
    userId: string,
    connectionId: string,
    body: unknown,
    ip: string | null,
  ): Promise<SchemaView> {
    const snapshot = await this.latest(userId, connectionId);
    const parsed = parseAllowlistInput(body, snapshot.document);
    if (!parsed.ok) {
      throw new AppException(
        'VALIDATION_ERROR',
        parsed.reason === 'unknown_object'
          ? 'The allowlist names a table or column that is not in the latest schema. Reload the allowlist and try again.'
          : 'The request was not valid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (parsed.version !== snapshot.version) {
      throw CHANGED;
    }
    const outcome = await this.repo.replaceAllowlist(
      userId,
      connectionId,
      snapshot.version,
      parsed.entries,
    );
    if (outcome === 'missing') {
      throw NOT_FOUND;
    }
    if (outcome === 'stale') {
      throw CHANGED;
    }
    await this.repo.writeAudit({
      userId,
      eventType: 'allowlist.updated',
      metadata: {
        connectionId,
        version: String(snapshot.version),
        tables: String(
          parsed.entries.filter((entry) => entry.columnName === null).length,
        ),
        columns: String(
          parsed.entries.filter((entry) => entry.columnName !== null).length,
        ),
      },
      ip,
    });
    return this.schema(userId, connectionId);
  }

  private async latest(userId: string, connectionId: string): Promise<StoredSnapshot> {
    await this.connections.get(userId, connectionId);
    const snapshot = await this.repo.latestSnapshot(userId, connectionId);
    if (!snapshot) {
      throw NOT_READY;
    }
    return snapshot;
  }

  private async audit(
    userId: string,
    connectionId: string,
    ip: string | null,
    details: Record<string, string>,
  ): Promise<void> {
    await this.repo.writeAudit({
      userId,
      eventType: 'schema.refreshed',
      metadata: { connectionId, ...details },
      ip,
    });
  }
}
