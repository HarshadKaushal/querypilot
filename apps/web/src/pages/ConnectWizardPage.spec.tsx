import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { AllowlistView, PublicConnection, RefreshSummary } from '../api/types';
import { eventStream, fakeApi, job, renderWithApp } from '../test/render';
import {
  ConnectWizardPage,
  validateConnection,
  type ConnectionForm,
} from './ConnectWizardPage';

const EGRESS = {
  egressIp: '203.0.113.10',
  setupSql: 'CREATE ROLE ayd_ro LOGIN;',
  firewall: 'Allow inbound database traffic only from the egress IP.',
};

const SAVED: PublicConnection = {
  id: 'c9',
  label: 'Sales',
  host: 'db.example',
  port: 5432,
  databaseName: 'sales',
  sslMode: 'require',
  status: 'active',
  lastTestedAt: '2026-10-14T10:00:00.000Z',
  sendSampleRowsToLlm: false,
  keyVersion: 1,
};

const SUMMARY: RefreshSummary = {
  connectionId: 'c9',
  version: 1,
  createdAt: '2026-10-14T10:00:01.000Z',
  tableCount: 1,
  columnCount: 2,
  defaultsApplied: true,
  newObjects: { tables: [], columns: [] },
};

const ALLOWLIST: AllowlistView = {
  connectionId: 'c9',
  version: 1,
  createdAt: '2026-10-14T10:00:01.000Z',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      kind: 'table',
      allowed: true,
      description: null,
      columns: [
        {
          name: 'id',
          type: 'integer',
          nullable: false,
          allowed: true,
          sensitive: false,
          description: null,
        },
      ],
    },
  ],
};

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Name'), 'Sales');
  await user.type(screen.getByLabelText('Host'), 'db.example');
  await user.type(screen.getByLabelText('Database'), 'sales');
  await user.type(screen.getByLabelText('Username'), 'sales_ro');
  await user.type(screen.getByLabelText('Password'), 'secret-pass');
}

describe('validateConnection', () => {
  const valid: ConnectionForm = {
    label: 'Sales',
    host: 'db.example',
    port: 5432,
    databaseName: 'sales',
    username: 'ro',
    password: 'pw',
    sslMode: 'require',
    sendSampleRowsToLlm: false,
  };

  it('accepts a complete form and checks the API limits per field', () => {
    expect(validateConnection(valid)).toEqual({});
    expect(
      validateConnection({
        ...valid,
        label: '  ',
        port: 70000,
        databaseName: 'x'.repeat(64),
      }),
    ).toEqual({
      label: 'Enter the name for this connection.',
      port: 'Enter a port from 1 to 65535.',
      databaseName: 'Use at most 63 characters.',
    });
  });
});

describe('ConnectWizardPage', () => {
  it('shows the egress address and the setup SQL first', async () => {
    renderWithApp(<ConnectWizardPage />, {
      api: fakeApi({ get: vi.fn().mockResolvedValue(EGRESS) }),
    });
    expect(await screen.findByText('203.0.113.10')).toBeInTheDocument();
    expect(screen.getByText('CREATE ROLE ayd_ro LOGIN;')).toBeInTheDocument();
  });

  it('checks the fields before sending anything', async () => {
    const api = fakeApi({ get: vi.fn().mockResolvedValue(EGRESS) });
    renderWithApp(<ConnectWizardPage />, { api });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(screen.getByText('Enter the host.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('saves the connection, reads the schema, then shows the allowlist', async () => {
    const get = vi.fn(async (path: string) =>
      path.endsWith('/allowlist') ? ALLOWLIST : EGRESS,
    );
    const post = vi
      .fn()
      .mockResolvedValueOnce(job({ id: 'j1' }))
      .mockResolvedValueOnce(job({ id: 'j2', kind: 'schema.refresh' }));
    const stream = vi
      .fn()
      .mockResolvedValueOnce(
        eventStream(
          job({ id: 'j1', state: 'running', stage: 'checking_access' }),
          job({ id: 'j1', state: 'succeeded', result: SAVED }),
        ),
      )
      .mockResolvedValueOnce(
        eventStream(
          job({ id: 'j2', kind: 'schema.refresh', state: 'succeeded', result: SUMMARY }),
        ),
      );
    const api = fakeApi({ get, post, stream });
    renderWithApp(<ConnectWizardPage />, { api });
    const user = userEvent.setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Check and save' }));

    expect(
      await screen.findByText('The connection was checked and saved.'),
    ).toBeInTheDocument();
    expect(post).toHaveBeenNthCalledWith(1, '/v1/connections', {
      label: 'Sales',
      host: 'db.example',
      port: 5432,
      databaseName: 'sales',
      username: 'sales_ro',
      password: 'secret-pass',
      sslMode: 'require',
      sendSampleRowsToLlm: false,
    });
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/v1/connections/c9/schema/refresh',
      undefined,
    );
    expect(screen.getByText(/Read 1 tables and 2 columns/)).toBeInTheDocument();
    expect(await screen.findByLabelText('Allow table public.orders')).toBeChecked();
  });

  it('keeps the form and explains why when the worker refuses the login', async () => {
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(EGRESS),
      post: vi.fn().mockResolvedValue(job()),
      stream: vi.fn().mockResolvedValue(
        eventStream(
          job({
            state: 'failed',
            error: {
              code: 'NOT_READ_ONLY',
              message: 'This login can change data. Use a login that can only read.',
              retryable: false,
            },
          }),
        ),
      ),
    });
    renderWithApp(<ConnectWizardPage />, { api });
    const user = userEvent.setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(
      await screen.findByText(
        'This login can change data. Use a login that can only read.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Code: NOT_READ_ONLY')).toBeInTheDocument();
    expect(screen.getByLabelText('Host')).toHaveValue('db.example');
  });

  it('shows a refused request, such as too many jobs, with its message', async () => {
    const api = fakeApi({
      get: vi.fn().mockResolvedValue(EGRESS),
      post: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            429,
            'TOO_MANY_JOBS',
            'You already have 3 jobs waiting or running.',
            'r7',
          ),
        ),
    });
    renderWithApp(<ConnectWizardPage />, { api });
    const user = userEvent.setup();
    await fillDetails(user);
    await user.click(screen.getByRole('button', { name: 'Check and save' }));
    expect(
      await screen.findByText('You already have 3 jobs waiting or running.'),
    ).toBeInTheDocument();
  });
});
