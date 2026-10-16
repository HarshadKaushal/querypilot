import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api-client';
import type { AllowlistView } from '../../../lib/api-types';
import { fakeApi, renderWithApp } from '../../../test/render';
import { AllowlistEditor } from './AllowlistEditor';

function view(): AllowlistView {
  return {
    connectionId: 'c1',
    version: 3,
    createdAt: '2026-10-14T10:00:00.000Z',
    tables: [
      {
        schema: 'public',
        name: 'customers',
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
          {
            name: 'email',
            type: 'text',
            nullable: true,
            allowed: false,
            sensitive: true,
            description: null,
          },
        ],
      },
      {
        schema: 'public',
        name: 'audit',
        kind: 'view',
        allowed: false,
        description: null,
        columns: [
          {
            name: 'at',
            type: 'timestamp with time zone',
            nullable: false,
            allowed: false,
            sensitive: false,
            description: null,
          },
        ],
      },
    ],
  };
}

function renderEditor(put = vi.fn().mockResolvedValue({})) {
  const onSaved = vi.fn();
  const onReload = vi.fn();
  const api = fakeApi({ put });
  renderWithApp(
    <AllowlistEditor
      connectionId="c1"
      view={view()}
      onSaved={onSaved}
      onReload={onReload}
    />,
    { api },
  );
  return { api, onSaved, onReload, user: userEvent.setup() };
}

describe('AllowlistEditor', () => {
  it('starts from what is allowed, and marks sensitive columns', async () => {
    const { user } = renderEditor();
    expect(screen.getByLabelText('Allow table public.customers')).toBeChecked();
    expect(screen.getByLabelText('Allow table public.audit')).not.toBeChecked();
    expect(
      screen.getByText('1 of 2 tables allowed.', { exact: false }),
    ).toBeInTheDocument();
    await user.click(screen.getByText('public.customers'));
    expect(
      screen.getByLabelText('Allow column public.customers.email'),
    ).not.toBeChecked();
    expect(screen.getByText('sensitive')).toBeInTheDocument();
  });

  it('saves only the ticked tables and columns, with their descriptions, for this version', async () => {
    const { api, onSaved, user } = renderEditor();
    await user.click(screen.getByText('public.customers'));
    await user.type(
      screen.getByLabelText('Description for public.customers.id'),
      '  Customer number ',
    );
    await user.click(screen.getByRole('button', { name: 'Save allowlist' }));
    expect(api.put).toHaveBeenCalledWith('/v1/connections/c1/allowlist', {
      version: 3,
      tables: [
        {
          schema: 'public',
          name: 'customers',
          description: null,
          columns: [{ name: 'id', description: 'Customer number' }],
        },
      ],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('will not save a ticked table with no ticked column', async () => {
    const { api, user } = renderEditor();
    await user.click(screen.getByLabelText('Allow table public.audit'));
    expect(screen.getByRole('alert')).toHaveTextContent('public.audit');
    expect(screen.getByRole('button', { name: 'Save allowlist' })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('offers a reload when the schema changed since it was loaded', async () => {
    const put = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'SCHEMA_CHANGED', 'The schema was refreshed.', 'r1'),
      );
    const { onReload, user } = renderEditor(put);
    await user.click(screen.getByRole('button', { name: 'Save allowlist' }));
    expect(await screen.findByText('The schema was refreshed.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reload the allowlist' }));
    expect(onReload).toHaveBeenCalled();
  });
});
