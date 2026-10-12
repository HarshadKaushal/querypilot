import { parseMasterKeyRing } from '@ayd/crypto';
import { loadEnv } from '../config/env';
import { UserDatabaseProbe, type ProbeResult } from '../executor/user-database.probe';
import { MemoryConnectionRepository } from './memory-connection.repository';
import type { ConnectionPools } from '../executor/connection-pools';
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
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://ayd:ayd@localhost:5434/ayd',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'test-jwt-secret-that-is-at-least-32',
    CRYPTO_MASTER_KEYS: KEYS,
    CRYPTO_MASTER_KEY_VERSION: '1',
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
