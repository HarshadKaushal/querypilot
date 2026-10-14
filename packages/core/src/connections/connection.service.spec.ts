import { parseMasterKeyRing } from '@ayd/crypto';
import { AppException } from '../errors/app.exception';
import { coreTestEnv } from '../testing/test-env';
import type { ConnectionPools } from '../user-database/connection-pools';
import {
  type ProbeResult,
  UserDatabaseProbe,
} from '../user-database/user-database.probe';
import { MemoryConnectionRepository } from '../testing/memory-connection.repository';
import { ConnectionService, type AddressResolver } from './connection.service';

const PASSWORD = 'sample_ro_password';
const KEYS = '1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

const input = {
  label: 'Sample',
  host: 'db.example',
  port: 5432,
  databaseName: 'sample',
  username: 'sample_ro',
  password: PASSWORD,
  sslMode: 'require',
};

function service(options?: {
  addresses?: string[];
  probe?: ProbeResult;
  allowPrivate?: boolean;
}) {
  const repo = new MemoryConnectionRepository();
  const resolver = {
    lookup: jest.fn(async () => options?.addresses ?? ['1.1.1.1']),
  } satisfies AddressResolver;
  const probe = {
    test: jest.fn(async () => options?.probe ?? { ok: true }),
  } as unknown as UserDatabaseProbe;
  const env = coreTestEnv({
    CRYPTO_MASTER_KEYS: KEYS,
    SSRF_ALLOW_PRIVATE: options?.allowPrivate ? 'true' : 'false',
  });
  const pools = { evict: jest.fn() } as unknown as ConnectionPools;
  const connections = new ConnectionService(repo, resolver, probe, env, pools);
  return { connections, repo, probe, resolver, pools };
}

describe('ConnectionService', () => {
  it('stores sealed credentials and never the password', async () => {
    const { connections, repo } = service();
    const created = await connections.create('user-1', input, '127.0.0.1');
    expect(created.status).toBe('active');
    expect(JSON.stringify(created)).not.toContain(PASSWORD);
    expect(JSON.stringify(repo.rows)).not.toContain(PASSWORD);
    expect(JSON.stringify(repo.audits)).not.toContain(PASSWORD);
    const ring = parseMasterKeyRing(KEYS, 1);
    const opened = repo.rows[0];
    expect(opened?.passwordCiphertext).not.toContain(PASSWORD);
    const { openCredentials } = await import('@ayd/crypto');
    expect(openCredentials(opened!, ring).password).toBe(PASSWORD);
  });

  it('rejects a private address and a metadata address', async () => {
    const privateHost = service({ addresses: ['10.0.0.4'] });
    await expect(
      privateHost.connections.create('user-1', input, null),
    ).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    const metadata = service({ addresses: ['169.254.169.254'], allowPrivate: true });
    await expect(
      metadata.connections.create('user-1', input, null),
    ).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
  });

  it('rejects plaintext SSL and a write-capable role', async () => {
    const { connections } = service();
    await expect(
      connections.create('user-1', { ...input, sslMode: 'disable' }, null),
    ).rejects.toMatchObject({ code: 'SSL_REQUIRED' });
    const write = service({
      probe: {
        ok: false,
        code: 'NOT_READ_ONLY',
        message: 'This role can change data. Revoke INSERT and grant only SELECT.',
      },
    });
    await expect(write.connections.create('user-1', input, null)).rejects.toMatchObject({
      code: 'NOT_READ_ONLY',
    });
  });

  it('hides another user connection as not found', async () => {
    const { connections } = service();
    const created = await connections.create('user-1', input, null);
    await expect(connections.get('user-2', created.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(connections.delete('user-2', created.id, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('audits a delete once, and a second delete of the same connection not at all', async () => {
    const { connections, repo } = service();
    const created = await connections.create('user-1', input, null);
    await connections.delete('user-1', created.id, '203.0.113.7');
    await expect(connections.delete('user-1', created.id, null)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.audits.filter((a) => a.eventType === 'connection.deleted')).toEqual([
      {
        userId: 'user-1',
        eventType: 'connection.deleted',
        metadata: { connectionId: created.id },
        ip: '203.0.113.7',
      },
    ]);
  });

  it('marks a failed retest as failing and does not log the password', async () => {
    const { connections, repo, probe } = service();
    const created = await connections.create('user-1', input, null);
    (probe.test as jest.Mock).mockResolvedValueOnce({
      ok: false,
      code: 'CONNECTION_FAILED',
      message: 'The database connection could not be completed.',
    });
    await expect(connections.test('user-1', created.id, null)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    expect(repo.rows[0]?.status).toBe('failing');
    expect(JSON.stringify(repo.audits)).not.toContain(PASSWORD);
  });

  it('renames without opening the database', async () => {
    const { connections, probe } = service();
    const created = await connections.create('user-1', input, null);
    (probe.test as jest.Mock).mockClear();
    const updated = await connections.update(
      'user-1',
      created.id,
      { label: 'Renamed' },
      null,
    );
    expect(updated.label).toBe('Renamed');
    expect(probe.test).not.toHaveBeenCalled();
  });

  it('records a retest whose host no longer resolves as failed', async () => {
    const { connections, repo, probe, resolver } = service();
    const created = await connections.create('user-1', input, null);
    resolver.lookup.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND db.example'));
    (probe.test as jest.Mock).mockClear();
    await expect(connections.test('user-1', created.id, null)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    expect(probe.test).not.toHaveBeenCalled();
    expect(repo.rows[0]?.status).toBe('failing');
    expect(repo.audits.at(-1)).toMatchObject({
      eventType: 'connection.tested',
      metadata: { connectionId: created.id, result: 'failed' },
    });
  });

  it('records a retest whose host now resolves to a blocked address as failed', async () => {
    const { connections, repo, resolver } = service();
    const created = await connections.create('user-1', input, null);
    resolver.lookup.mockResolvedValueOnce(['10.0.0.5']);
    await expect(connections.test('user-1', created.id, null)).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    expect(repo.rows[0]?.status).toBe('failing');
    expect(repo.audits.at(-1)?.metadata.result).toBe('failed');
  });

  it('keeps a failing connection failing when only the label changes', async () => {
    const { connections, repo, probe } = service();
    const created = await connections.create('user-1', input, null);
    (probe.test as jest.Mock).mockResolvedValueOnce({
      ok: false,
      code: 'CONNECTION_FAILED',
      message: 'The database connection could not be completed.',
    });
    await expect(connections.test('user-1', created.id, null)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    const testedAt = repo.rows[0]?.lastTestedAt;
    const updated = await connections.update(
      'user-1',
      created.id,
      { label: 'Renamed' },
      null,
    );
    expect(updated.status).toBe('failing');
    expect(repo.rows[0]?.lastTestedAt).toEqual(testedAt);
  });

  it('marks the connection active again after changed credentials pass the probe', async () => {
    const { connections, probe } = service();
    const created = await connections.create('user-1', input, null);
    (probe.test as jest.Mock).mockResolvedValueOnce({
      ok: false,
      code: 'CONNECTION_FAILED',
      message: 'The database connection could not be completed.',
    });
    await expect(connections.test('user-1', created.id, null)).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    const updated = await connections.update(
      'user-1',
      created.id,
      { password: 'a-new-password' },
      null,
    );
    expect(updated.status).toBe('active');
  });

  it('closes the open pool when credentials change or the connection is deleted', async () => {
    const { connections, pools } = service();
    const created = await connections.create('user-1', input, null);
    await connections.update('user-1', created.id, { label: 'Renamed' }, null);
    expect(pools.evict).not.toHaveBeenCalled();
    await connections.update(
      'user-1',
      created.id,
      { password: 'rotated-password' },
      null,
    );
    expect(pools.evict).toHaveBeenCalledWith(created.id);
    await connections.delete('user-1', created.id, null);
    expect(pools.evict).toHaveBeenCalledTimes(2);
  });

  it('deletes the schema when the host, port, or database changes, and says so in the audit', async () => {
    const { connections, repo } = service();
    const created = await connections.create('user-1', input, null);
    await connections.update('user-1', created.id, { databaseName: 'other_db' }, null);
    expect(repo.schemaResets).toEqual([created.id]);
    expect(repo.audits.at(-1)?.metadata).toEqual({
      connectionId: created.id,
      schemaReset: 'true',
    });
    await connections.update('user-1', created.id, { port: 6543 }, null);
    await connections.update('user-1', created.id, { host: 'db2.example' }, null);
    expect(repo.schemaResets).toHaveLength(3);
  });

  it('keeps the schema for new credentials, SSL mode, or a rename', async () => {
    const { connections, repo } = service();
    const created = await connections.create('user-1', input, null);
    await connections.update(
      'user-1',
      created.id,
      { password: 'rotated-password' },
      null,
    );
    await connections.update('user-1', created.id, { username: 'other_ro' }, null);
    await connections.update('user-1', created.id, { sslMode: 'verify-full' }, null);
    await connections.update('user-1', created.id, { label: 'Renamed' }, null);
    expect(repo.schemaResets).toEqual([]);
    expect(repo.audits.at(-1)?.metadata).toEqual({ connectionId: created.id });
  });
});

describe('ConnectionService halves (API prepares, worker checks)', () => {
  it('prepares a create without contacting the database or storing anything', () => {
    const { connections, repo, probe, resolver } = service();
    const pending = connections.prepareCreate(input);
    expect(pending.settings).toEqual({
      label: input.label,
      host: input.host,
      port: input.port,
      databaseName: input.databaseName,
      sslMode: 'require',
      sendSampleRowsToLlm: false,
    });
    // The payload a job carries holds the credentials only sealed.
    expect(JSON.stringify(pending)).not.toContain(PASSWORD);
    expect(JSON.stringify(pending)).not.toContain(input.username);
    expect(probe.test).not.toHaveBeenCalled();
    expect(resolver.lookup).not.toHaveBeenCalled();
    expect(repo.rows).toHaveLength(0);
  });

  it('rejects bad input while preparing, before any job exists', () => {
    const { connections } = service();
    expect(() => connections.prepareCreate({ ...input, sslMode: 'disable' })).toThrow(
      AppException,
    );
  });

  it('stores the prepared connection only after the check passes', async () => {
    const passing = service();
    const created = await passing.connections.createChecked(
      'user-1',
      passing.connections.prepareCreate(input),
      null,
    );
    expect(passing.repo.rows).toHaveLength(1);
    expect(created.status).toBe('active');

    const writer = service({
      probe: { ok: false, code: 'NOT_READ_ONLY', message: 'This role can change data.' },
    });
    await expect(
      writer.connections.createChecked(
        'user-1',
        writer.connections.prepareCreate(input),
        null,
      ),
    ).rejects.toMatchObject({ code: 'NOT_READ_ONLY' });
    expect(writer.repo.rows).toHaveLength(0);
    expect(writer.repo.audits).toHaveLength(0);
  });

  it('saves a rename at once and hands a new host to the worker unsaved', async () => {
    const { connections, repo, probe } = service();
    const created = await connections.create('user-1', input, null);
    (probe.test as jest.Mock).mockClear();

    const rename = await connections.prepareUpdate(
      'user-1',
      created.id,
      { label: 'New' },
      null,
    );
    expect(rename).toMatchObject({ check: false, connection: { label: 'New' } });

    const move = await connections.prepareUpdate(
      'user-1',
      created.id,
      { host: 'other.example' },
      null,
    );
    expect(move.check).toBe(true);
    expect(repo.rows[0]?.host).toBe('db.example');
    expect(probe.test).not.toHaveBeenCalled();
    if (move.check) {
      expect(JSON.stringify(move.pending)).not.toContain(PASSWORD);
      const moved = await connections.updateChecked(
        'user-1',
        created.id,
        move.pending,
        null,
      );
      expect(moved).toMatchObject({ host: 'other.example', label: 'New' });
      expect(repo.schemaResets).toEqual([created.id]);
    }
  });

  it('keeps the old settings when the changed login fails the check', async () => {
    const { connections, repo, probe } = service();
    const created = await connections.create('user-1', input, null);
    const plan = await connections.prepareUpdate(
      'user-1',
      created.id,
      { password: 'other-password' },
      null,
    );
    (probe.test as jest.Mock).mockResolvedValueOnce({
      ok: false,
      code: 'CONNECTION_FAILED',
      message: 'Check the username and password.',
    });
    if (!plan.check) {
      throw new Error('expected a check');
    }
    await expect(
      connections.updateChecked('user-1', created.id, plan.pending, null),
    ).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
    const ring = parseMasterKeyRing(KEYS, 1);
    const { openCredentials } = await import('@ayd/crypto');
    expect(openCredentials(repo.rows[0]!, ring).password).toBe(PASSWORD);
  });

  it('returns the stored connection when a retried create finds it, without checking again', async () => {
    const { connections, repo, probe } = service();
    const pending = connections.prepareCreate(input);
    const first = await connections.createChecked('user-1', pending, null);
    (probe.test as jest.Mock).mockClear();
    const again = await connections.createChecked('user-1', pending, null);
    expect(again).toEqual(first);
    expect(repo.rows).toHaveLength(1);
    expect(probe.test).not.toHaveBeenCalled();
    expect(
      repo.audits.filter((row) => row.eventType === 'connection.created'),
    ).toHaveLength(1);
  });

  it('stores nothing when cancelled after the check passed', async () => {
    const { connections, repo } = service();
    const controller = new AbortController();
    (
      connections as unknown as { probe: { test: jest.Mock } }
    ).probe.test.mockImplementation(async () => {
      controller.abort('cancelled by its owner');
      return { ok: true };
    });
    await expect(
      connections.createChecked(
        'user-1',
        connections.prepareCreate(input),
        null,
        controller.signal,
      ),
    ).rejects.toBe('cancelled by its owner');
    expect(repo.rows).toHaveLength(0);
  });
});
