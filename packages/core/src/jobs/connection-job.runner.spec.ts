import type { ConnectionService } from '../connections/connection.service';
import { AppException } from '../errors/app.exception';
import type { SchemaService } from '../schema/schema.service';
import { ConnectionJobRunner } from './connection-job.runner';
import { JobProcessor } from './job-processor';
import { withoutCredentials } from './job.types';
import type { QueryJobRunner } from './query-job.runner';

const pending = {
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
    expect(connections.createChecked).toHaveBeenCalledWith('u1', pending, null);
    await expect(
      run.update({ userId: 'u1', connectionId: 'c1', ip: '10.0.0.1', pending }),
    ).resolves.toMatchObject({ ok: true, result: { host: 'other' } });
    expect(connections.updateChecked).toHaveBeenCalledWith(
      'u1',
      'c1',
      pending,
      '10.0.0.1',
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
      pending: { settings: pending.settings },
    });
  });

  it('leaves payloads without credentials alone', () => {
    expect(
      withoutCredentials({ userId: 'u1', connectionId: 'c1', sql: 'SELECT 1' }),
    ).toBeNull();
    expect(withoutCredentials({ pending: { settings: {} } })).toBeNull();
    expect(withoutCredentials(null)).toBeNull();
  });

  it('runs the job, then rewrites its stored payload without the credentials', async () => {
    const { run } = runner();
    const processor = new JobProcessor({} as QueryJobRunner, run);
    const updateData = jest.fn().mockResolvedValue(undefined);
    const data = { userId: 'u1', ip: null, pending };
    const outcome = await processor.handle(
      { name: 'connection.create', data, updateData },
      jest.fn(),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(updateData).toHaveBeenCalledWith({
      userId: 'u1',
      ip: null,
      pending: { settings: pending.settings },
    });
  });

  it('reports a failed cleanup instead of failing a job whose work is done', async () => {
    const { run } = runner();
    const processor = new JobProcessor({} as QueryJobRunner, run);
    const onCleanupError = jest.fn();
    const outcome = await processor.handle(
      {
        name: 'connection.create',
        data: { userId: 'u1', ip: null, pending },
        updateData: jest.fn().mockRejectedValue(new Error('redis blip')),
      },
      onCleanupError,
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(onCleanupError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not touch the payload when the job itself throws, so a retry still has it', async () => {
    const { run } = runner({
      createChecked: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const processor = new JobProcessor({} as QueryJobRunner, run);
    const updateData = jest.fn();
    await expect(
      processor.handle(
        {
          name: 'connection.create',
          data: { userId: 'u1', ip: null, pending },
          updateData,
        },
        jest.fn(),
      ),
    ).rejects.toThrow('boom');
    expect(updateData).not.toHaveBeenCalled();
  });
});
