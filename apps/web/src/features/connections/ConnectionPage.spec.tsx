import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import type { PublicConnection } from '../../lib/api-types';
import { eventStream, fakeApi, job, renderWithApp } from '../../test/render';
import { ConnectionPage } from './ConnectionPage';

const CONNECTION: PublicConnection = {
  id: 'c1',
  label: 'Sales',
  host: 'db.example',
  port: 5432,
  databaseName: 'sales',
  sslMode: 'require',
  status: 'active',
  lastTestedAt: null,
  sendSampleRowsToLlm: false,
  keyVersion: 1,
};

const NOT_READY = new ApiError(
  409,
  'SCHEMA_NOT_READY',
  'The schema for this connection has not been read yet.',
  'r1',
);

function renderPage(overrides: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(overrides);
  renderWithApp(
    <Routes>
      <Route path="/connections/:id" element={<ConnectionPage />} />
    </Routes>,
    { api, route: '/connections/c1' },
  );
  return { api, user: userEvent.setup() };
}

describe('ConnectionPage', () => {
  it('offers to read the schema when it has not been read yet', async () => {
    const { api, user } = renderPage({
      get: vi.fn(async (path: string) => {
        if (path.endsWith('/allowlist')) {
          throw NOT_READY;
        }
        return CONNECTION;
      }),
      post: vi.fn().mockResolvedValue(job({ kind: 'schema.refresh' })),
      stream: vi.fn().mockResolvedValue(
        eventStream(
          job({
            kind: 'schema.refresh',
            state: 'failed',
            error: {
              code: 'CONNECTION_FAILED',
              message: 'The database could not be reached.',
              retryable: true,
            },
          }),
        ),
      ),
    });
    expect(await screen.findByRole('heading', { name: 'Sales' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Read schema' }));
    expect(api.post).toHaveBeenCalledWith('/v1/connections/c1/schema/refresh', undefined);
    expect(
      await screen.findByText('The database could not be reached.'),
    ).toBeInTheDocument();
  });

  it('turns sample rows on with a PATCH, and shows the saved value', async () => {
    const { api, user } = renderPage({
      get: vi.fn(async (path: string) => {
        if (path.endsWith('/allowlist')) {
          throw NOT_READY;
        }
        return CONNECTION;
      }),
      send: vi.fn().mockResolvedValue({
        status: 200,
        data: { ...CONNECTION, sendSampleRowsToLlm: true },
      }),
    });
    const toggle = await screen.findByRole('switch');
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(api.send).toHaveBeenCalledWith('/v1/connections/c1', {
      method: 'PATCH',
      body: { sendSampleRowsToLlm: true },
    });
    expect(await screen.findByRole('switch')).toBeChecked();
  });

  it('tests the connection as a job, and shows a failure with its code', async () => {
    const { api, user } = renderPage({
      get: vi.fn(async (path: string) => {
        if (path.endsWith('/allowlist')) {
          throw NOT_READY;
        }
        return CONNECTION;
      }),
      post: vi.fn().mockResolvedValue(job({ kind: 'connection.test' })),
      stream: vi.fn().mockResolvedValue(
        eventStream(
          job({
            kind: 'connection.test',
            state: 'failed',
            error: {
              code: 'SSL_REQUIRED',
              message: 'The server does not offer SSL.',
              retryable: false,
            },
          }),
        ),
      ),
    });
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(api.post).toHaveBeenCalledWith('/v1/connections/c1/test', undefined);
    expect(await screen.findByText('The server does not offer SSL.')).toBeInTheDocument();
    expect(screen.getByText('Code: SSL_REQUIRED')).toBeInTheDocument();
  });

  it('says so when the connection does not exist or is not yours', async () => {
    renderPage({
      get: vi
        .fn()
        .mockRejectedValue(
          new ApiError(404, 'NOT_FOUND', 'That resource was not found.', 'r2'),
        ),
    });
    expect(await screen.findByText('This connection was not found')).toBeInTheDocument();
  });
});
