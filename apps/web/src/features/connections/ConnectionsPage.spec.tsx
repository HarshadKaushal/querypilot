import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import type { PublicConnection } from '../../lib/api-types';
import { fakeApi, renderWithApp } from '../../test/render';
import { ConnectionsPage } from './ConnectionsPage';

function connection(fields: Partial<PublicConnection>): PublicConnection {
  return {
    id: 'c1',
    label: 'Sales',
    host: 'db.example',
    port: 5432,
    databaseName: 'sales',
    sslMode: 'require',
    status: 'active',
    lastTestedAt: '2026-10-14T10:00:00.000Z',
    sendSampleRowsToLlm: false,
    keyVersion: 1,
    ...fields,
  };
}

describe('ConnectionsPage', () => {
  it('lists connections with their status, and never asks for credentials', async () => {
    const api = fakeApi({
      get: vi.fn().mockResolvedValue([
        connection({}),
        connection({
          id: 'c2',
          label: 'Ops',
          databaseName: 'ops',
          status: 'failing',
          lastTestedAt: null,
        }),
      ]),
    });
    renderWithApp(<ConnectionsPage />, { api });
    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('db.example:5432/sales')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Failing')).toBeInTheDocument();
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/v1/connections', expect.anything());
  });

  it('says so when there are no connections', async () => {
    renderWithApp(<ConnectionsPage />, {
      api: fakeApi({ get: vi.fn().mockResolvedValue([]) }),
    });
    expect(await screen.findByText(/No databases connected yet/)).toBeInTheDocument();
  });

  it('shows the API error when the list cannot load', async () => {
    const api = fakeApi({
      get: vi
        .fn()
        .mockRejectedValue(
          new ApiError(
            500,
            'INTERNAL_ERROR',
            'Something went wrong. Try again.',
            'req-1',
          ),
        ),
    });
    renderWithApp(<ConnectionsPage />, { api });
    expect(await screen.findByRole('alert')).toHaveTextContent('Request id: req-1');
  });

  it('deletes a connection after confirming, then reloads the list', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce([connection({})])
      .mockResolvedValueOnce([]);
    const api = fakeApi({ get, delete: vi.fn().mockResolvedValue(undefined) });
    renderWithApp(<ConnectionsPage />, { api });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete Sales?');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(api.delete).toHaveBeenCalledWith('/v1/connections/c1');
    expect(await screen.findByText(/No databases connected yet/)).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
