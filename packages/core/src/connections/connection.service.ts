import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  openCredentials,
  parseMasterKeyRing,
  sealCredentials,
  type SealedCredentials,
} from '@ayd/crypto';
import { ConnectionStatus } from '@ayd/database';
import { assessResolution } from '@ayd/ssrf-guard';
import { AppException, invalidRequest, notFound } from '../errors/app.exception';
import { ConnectionPools } from '../user-database/connection-pools';
import {
  type ProbeRequest,
  type ProbeResult,
  type SslMode,
  UserDatabaseProbe,
} from '../user-database/user-database.probe';
import { APP_ENV, type CoreEnv } from '../config/env';
import {
  CONNECTION_REPOSITORY,
  toPublicConnection,
  type ConnectionRepository,
  type PublicConnection,
  type StoredConnection,
} from './connection.repository';

export interface ConnectionInput {
  label: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
  sslMode: string;
  sendSampleRowsToLlm?: boolean;
}

export interface AddressResolver {
  lookup(hostname: string): Promise<string[]>;
}

export const ADDRESS_RESOLVER = Symbol('ADDRESS_RESOLVER');

/** The settings of a connection that are not secret. */
export interface ConnectionSettings {
  label: string;
  host: string;
  port: number;
  databaseName: string;
  sslMode: SslMode;
  sendSampleRowsToLlm: boolean;
}

/**
 * A new or changed connection waiting for the worker's check. The credentials are sealed,
 * so a job payload carrying this never holds them in plaintext.
 */
export interface PendingConnection {
  settings: ConnectionSettings;
  sealed: SealedCredentials;
}

/** A new connection waiting for the check. The API picks its id, so a retry can find it. */
export interface PendingCreate extends PendingConnection {
  id: string;
}

export type UpdatePlan =
  | { check: false; connection: PublicConnection }
  | { check: true; pending: PendingConnection };

export type ConnectionTarget =
  | { ok: true; row: StoredConnection; request: ProbeRequest }
  | { ok: false; row: StoredConnection; error: AppException };

@Injectable()
export class DnsAddressResolver implements AddressResolver {
  async lookup(hostname: string): Promise<string[]> {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  }
}

@Injectable()
export class ConnectionService {
  private readonly keys: ReturnType<typeof parseMasterKeyRing>;

  constructor(
    @Inject(CONNECTION_REPOSITORY) private readonly repo: ConnectionRepository,
    @Inject(ADDRESS_RESOLVER) private readonly resolver: AddressResolver,
    private readonly probe: UserDatabaseProbe,
    @Inject(APP_ENV) private readonly env: CoreEnv,
    // Optional so unit tests can build the service without the executor.
    @Optional() private readonly pools?: ConnectionPools,
  ) {
    this.keys = parseMasterKeyRing(env.CRYPTO_MASTER_KEYS, env.CRYPTO_MASTER_KEY_VERSION);
  }

  /** Both halves of create in one process, for scripts and tests. The API queues instead. */
  async create(
    userId: string,
    input: ConnectionInput,
    ip: string | null,
  ): Promise<PublicConnection> {
    return this.createChecked(userId, this.prepareCreate(input), ip);
  }

  /**
   * The API's half of create: validates the input (400 when it is bad) and seals the
   * credentials. Nothing is stored and no database is contacted.
   */
  prepareCreate(input: ConnectionInput): PendingCreate {
    const { username, password, ...settings } = this.parse(input);
    return {
      id: randomUUID(),
      settings,
      sealed: sealCredentials(username, password, this.keys),
    };
  }

  /**
   * The worker's half: opens the credentials in memory, pins the host, and runs the
   * read-only check. The connection is stored only if the check passes, so a login that
   * can write is never kept.
   */
  async createChecked(
    userId: string,
    pending: PendingCreate,
    ip: string | null,
    signal?: AbortSignal,
  ): Promise<PublicConnection> {
    // A job retried after a crash may already have stored this connection.
    const stored = await this.repo.findOwned(userId, pending.id);
    if (stored) {
      return toPublicConnection(stored);
    }
    const secrets = openCredentials(pending.sealed, this.keys);
    const pinned = await this.pin(pending.settings.host);
    await this.assertReadable({ ...pending.settings, ...secrets }, pinned);
    // Cancelled during the check: store nothing.
    signal?.throwIfAborted();
    const created = await this.repo.insert({
      id: pending.id,
      userId,
      ...pending.settings,
      status: ConnectionStatus.Active,
      lastTestedAt: new Date(),
      ...pending.sealed,
    });
    await this.repo.writeAudit({
      userId,
      eventType: 'connection.created',
      metadata: { connectionId: created.id },
      ip,
    });
    return created;
  }

  async list(userId: string): Promise<PublicConnection[]> {
    return this.repo.list(userId);
  }

  async get(userId: string, id: string): Promise<PublicConnection> {
    const row = await this.repo.findOwned(userId, id);
    if (!row) {
      throw notFound();
    }
    return toPublicConnection(row);
  }

  async test(userId: string, id: string, ip: string | null): Promise<PublicConnection> {
    const target = await this.resolveTarget(userId, id);
    let failure = target.ok ? null : target.error;
    if (target.ok) {
      const result = await this.probe.test(target.request);
      failure = result.ok ? null : probeError(result);
    }
    const updated = await this.recordTest(userId, id, failure === null);
    await this.repo.writeAudit({
      userId,
      eventType: 'connection.tested',
      metadata: { connectionId: id, result: failure ? 'failed' : 'ok' },
      ip,
    });
    if (failure) {
      throw failure;
    }
    return updated ?? toPublicConnection(target.row);
  }

  /** Both halves of update in one process, for scripts and tests. The API queues instead. */
  async update(
    userId: string,
    id: string,
    input: Partial<ConnectionInput>,
    ip: string | null,
  ): Promise<PublicConnection> {
    const plan = await this.prepareUpdate(userId, id, input, ip);
    return plan.check
      ? this.updateChecked(userId, id, plan.pending, ip)
      : plan.connection;
  }

  /**
   * The API's half of update. A change that cannot reach a different database or login (the
   * label, the sample-rows setting) is saved at once. Anything else is validated and sealed
   * for the worker to check first.
   */
  async prepareUpdate(
    userId: string,
    id: string,
    input: Partial<ConnectionInput>,
    ip: string | null,
  ): Promise<UpdatePlan> {
    const existing = await this.requireOwned(userId, id);
    const secrets = openCredentials(existing, this.keys);
    const { username, password, ...settings } = this.parse({
      label: input.label ?? existing.label,
      host: input.host ?? existing.host,
      port: input.port ?? existing.port,
      databaseName: input.databaseName ?? existing.databaseName,
      username: input.username ?? secrets.username,
      password: input.password ?? secrets.password,
      sslMode: input.sslMode ?? existing.sslMode,
      sendSampleRowsToLlm: input.sendSampleRowsToLlm ?? existing.sendSampleRowsToLlm,
    });
    const connectionChanged =
      settings.host !== existing.host ||
      settings.port !== existing.port ||
      settings.databaseName !== existing.databaseName ||
      username !== secrets.username ||
      password !== secrets.password ||
      settings.sslMode !== existing.sslMode;
    if (connectionChanged) {
      return {
        check: true,
        pending: { settings, sealed: sealCredentials(username, password, this.keys) },
      };
    }
    // Status and test time change only when a check runs. A rename keeps a failing
    // connection failing.
    const updated = await this.repo.update(userId, id, {
      label: settings.label,
      sendSampleRowsToLlm: settings.sendSampleRowsToLlm,
    });
    if (!updated) {
      throw notFound();
    }
    await this.repo.writeAudit({
      userId,
      eventType: 'connection.updated',
      metadata: { connectionId: id },
      ip,
    });
    return { check: false, connection: updated };
  }

  /** The worker's half: checks the changed login, and saves the change only if it passes. */
  async updateChecked(
    userId: string,
    id: string,
    pending: PendingConnection,
    ip: string | null,
    signal?: AbortSignal,
  ): Promise<PublicConnection> {
    // Compared with the row as it is now, in case it changed since the API read it.
    const existing = await this.requireOwned(userId, id);
    // A different host, port, or database may be a different database altogether, so its
    // old snapshot and allowlist are deleted and the schema has to be read and reviewed
    // again. New credentials or SSL settings reach the same database and keep them.
    const databaseChanged =
      pending.settings.host !== existing.host ||
      pending.settings.port !== existing.port ||
      pending.settings.databaseName !== existing.databaseName;
    const secrets = openCredentials(pending.sealed, this.keys);
    const pinned = await this.pin(pending.settings.host);
    await this.assertReadable({ ...pending.settings, ...secrets }, pinned);
    signal?.throwIfAborted();
    const updated = await this.repo.update(
      userId,
      id,
      {
        ...pending.settings,
        status: ConnectionStatus.Active,
        lastTestedAt: new Date(),
        ...pending.sealed,
      },
      { resetSchema: databaseChanged },
    );
    if (!updated) {
      throw notFound();
    }
    // Open sockets in this process still use the old host or credentials.
    this.pools?.evict(id);
    await this.repo.writeAudit({
      userId,
      eventType: 'connection.updated',
      metadata: databaseChanged
        ? { connectionId: id, schemaReset: 'true' }
        : { connectionId: id },
      ip,
    });
    return updated;
  }

  async delete(userId: string, id: string, ip: string | null): Promise<void> {
    // The repository deletes and audits in one transaction, and audits only a real delete,
    // so a failure leaves neither and two requests at once write one audit row. Someone
    // else's id deletes nothing and looks the same as a missing one.
    if (!(await this.repo.delete(userId, id, ip))) {
      throw notFound();
    }
    // Pools are closed only once the delete is committed.
    this.pools?.evict(id);
  }

  /**
   * Everything the executor needs to open this user's connection: ownership checked,
   * credentials decrypted in memory, and the host resolved and pinned by the SSRF guard.
   */
  async resolveTarget(userId: string, id: string): Promise<ConnectionTarget> {
    // Not yours, or gone: throws NOT_FOUND, because there is no connection to record on.
    const row = await this.requireOwned(userId, id);
    // An address that no longer resolves, or now resolves somewhere blocked, is returned
    // instead of thrown, so the caller can record it like any other failed check.
    let pinned: string;
    try {
      pinned = await this.pin(row.host);
    } catch (error) {
      if (error instanceof AppException) {
        return { ok: false, row, error };
      }
      throw error;
    }
    const secrets = openCredentials(row, this.keys);
    return {
      ok: true,
      row,
      request: {
        hostIp: pinned,
        port: row.port,
        database: row.databaseName,
        username: secrets.username,
        password: secrets.password,
        sslMode: row.sslMode as SslMode,
        servername: row.host,
      },
    };
  }

  /** Records the outcome of a probe that just ran against this connection. */
  async recordTest(
    userId: string,
    id: string,
    ok: boolean,
  ): Promise<PublicConnection | null> {
    return this.repo.update(userId, id, {
      status: ok ? ConnectionStatus.Active : ConnectionStatus.Failing,
      lastTestedAt: new Date(),
    });
  }

  private async requireOwned(userId: string, id: string) {
    const row = await this.repo.findOwned(userId, id);
    if (!row) {
      throw notFound();
    }
    return row;
  }

  private parse(input: ConnectionInput) {
    const label = input.label?.trim() ?? '';
    const host = input.host?.trim() ?? '';
    const databaseName = input.databaseName?.trim() ?? '';
    const username = input.username ?? '';
    const password = input.password ?? '';
    const sslMode = input.sslMode?.trim() ?? '';
    if (
      label.length < 1 ||
      label.length > 80 ||
      host.length < 1 ||
      host.length > 253 ||
      databaseName.length < 1 ||
      databaseName.length > 63 ||
      username.length < 1 ||
      username.length > 128 ||
      password.length < 1 ||
      password.length > 256 ||
      !Number.isInteger(input.port) ||
      input.port < 1 ||
      input.port > 65535
    ) {
      throw invalidRequest();
    }
    if (sslMode === 'disable' || sslMode === 'allow' || sslMode === 'prefer') {
      throw new AppException(
        'SSL_REQUIRED',
        'Plaintext connections are not allowed. Set the SSL mode to require or verify-full.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (sslMode !== 'require' && sslMode !== 'verify-full') {
      throw invalidRequest();
    }
    return {
      label,
      host,
      port: input.port,
      databaseName,
      username,
      password,
      sslMode: sslMode as SslMode,
      sendSampleRowsToLlm: input.sendSampleRowsToLlm === true,
    };
  }

  private async pin(host: string): Promise<string> {
    try {
      const addresses = isIP(host) ? [host] : await this.resolver.lookup(host);
      const verdict = assessResolution(host, addresses, {
        allowPrivate: this.env.SSRF_ALLOW_PRIVATE,
      });
      if (!verdict.ok) {
        throw new AppException(
          'SSRF_BLOCKED',
          'That database address is not allowed. Use a public hostname, or a private address only in local development.',
          HttpStatus.BAD_REQUEST,
        );
      }
      return verdict.pinnedAddress;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      throw new AppException(
        'CONNECTION_FAILED',
        'The database host could not be resolved.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async assertReadable(
    input: {
      port: number;
      databaseName: string;
      username: string;
      password: string;
      sslMode: SslMode;
      host: string;
    },
    pinned: string,
  ): Promise<void> {
    const result = await this.probe.test({
      hostIp: pinned,
      port: input.port,
      database: input.databaseName,
      username: input.username,
      password: input.password,
      sslMode: input.sslMode,
      servername: input.host,
    });
    if (!result.ok) {
      throw probeError(result);
    }
  }
}

export function probeError(result: Exclude<ProbeResult, { ok: true }>): AppException {
  const status =
    result.code === 'CONNECTION_FAILED' ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST;
  return new AppException(result.code, result.message, status);
}
