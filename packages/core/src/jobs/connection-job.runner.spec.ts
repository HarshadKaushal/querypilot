import type { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import type { SchemaService } from '../schema/schema.service';
import { ConnectionJobRunner } from './connection-job.runner';
import { withoutCredentials } from './job.types';

const pending = {
  id: '0b9d6f1e-3c2a-4e5b-8f7a-1c2d3e4f5a6b',
  settings: {
    label: 'Sample',
    host: 'db.example',
    port: 5432,
    databaseName: 'sample',
    sslMode: 'require' as const,
    sendSampleRowsToLlm: false,
  },
  sealed: {
    usernameCiphertext: 'u',
    usernameIv: 'u',
    usernameTag: 'u',
    passwordCiphertext: 'p',
    passwordIv: 'p',
    passwordTag: 'p',
    encryptedDataKey: 'k',
    dataKeyIv: 'k',
    dataKeyTag: 'k',
    keyVersion: 1,
  },
};

function runner(overrides: Partial<Record<keyof ConnectionService, jest.Mock>> = {}) {
  const connections = {
    createChecked: jest.fn().mockResolvedValue({ id: 'c1', status: 'active' }),
    updateChecked: jest.fn().mockResolvedValue({ id: 'c1', host: 'other' }),
    test: jest.fn().mockResolvedValue({ id: 'c1', status: 'active' }),
    ...overrides,
  } as unknown as ConnectionService;
  const schemas = {
    refresh: jest.fn().mockResolvedValue({ version: 2, tableCount: 3 }),
  } as unknown as SchemaService;
  return { run: new ConnectionJobRunner(connections, schemas), connections, schemas };
}

describe('ConnectionJobRunner', () => {
  it('returns the saved connection or summary as the result', async () => {
    const { run, connections, schemas } = runner();
    await expect(run.create({ userId: 'u1', ip: null, pending })).resolves.toEqual({
      ok: true,
      result: { id: 'c1', status: 'active' },
    });
    // No signal outside a worker: the default context has none.
    expect(connections.createChecked).toHaveBeenCalledWith(
      'u1',
      pending,
      null,
      undefined,
    );
    await expect(
      run.update({ userId: 'u1', connectionId: 'c1', ip: '10.0.0.1', pending }),
    ).resolves.toMatchObject({ ok: true, result: { host: 'other' } });
    expect(connections.updateChecked).toHaveBeenCalledWith(
      'u1',
      'c1',
      pending,
      '10.0.0.1',
      undefined,
    );
    await expect(
      run.test({ userId: 'u1', connectionId: 'c1', ip: null }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      run.refresh({ userId: 'u1', connectionId: 'c1', ip: null }),
    ).resolves.toEqual({ ok: true, result: { version: 2, tableCount: 3 } });
    expect(schemas.refresh).toHaveBeenCalledWith('u1', 'c1', null);
  });

  it('turns a failed check into an outcome with its code and message', async () => {
    const { run } = runner({
      createChecked: jest
        .fn()
        .mockRejectedValue(
          new AppException('NOT_READ_ONLY', 'This role can change data.', 400),
        ),
    });
    await expect(run.create({ userId: 'u1', ip: null, pending })).resolves.toEqual({
      ok: false,
      error: {
        code: 'NOT_READ_ONLY',
        message: 'This role can change data.',
        retryable: false,
      },
    });
  });

  it('lets an unexpected error escape', async () => {
    const { run } = runner({ test: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(
      run.test({ userId: 'u1', connectionId: 'c1', ip: null }),
    ).rejects.toThrow('boom');
  });
});

describe('dropping credentials from finished jobs', () => {
  it('removes only the sealed credentials, keeping everything else', () => {
    expect(withoutCredentials({ userId: 'u1', ip: null, pending })).toEqual({
      userId: 'u1',
      ip: null,
      pending: { id: pending.id, settings: pending.settings },
    });
  });

  it('leaves payloads without credentials alone', () => {
    expect(
      withoutCredentials({ userId: 'u1', connectionId: 'c1', sql: 'SELECT 1' }),
    ).toBeNull();
    expect(withoutCredentials({ pending: { settings: {} } })).toBeNull();
    expect(withoutCredentials(null)).toBeNull();
  });
});
