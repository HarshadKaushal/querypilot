import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { fakeApi, renderWithApp } from '../../test/render';
import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  it('shows the account and signs out', async () => {
    const { auth } = renderWithApp(<SettingsPage />);
    expect(screen.getByText('dev@localhost')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('deletes the account only after "delete" is typed, then signs out', async () => {
    const api = fakeApi({ delete: vi.fn().mockResolvedValue(undefined) });
    const { auth } = renderWithApp(<SettingsPage />, { api });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    const confirm = await screen.findByRole('button', { name: 'Delete my account' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Type "delete" to confirm'), 'delete');
    await user.click(confirm);
    expect(api.delete).toHaveBeenCalledWith('/v1/users/me');
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('keeps the user signed in and explains when deletion fails', async () => {
    const api = fakeApi({
      delete: vi
        .fn()
        .mockRejectedValue(
          new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong. Try again.', 'r9'),
        ),
    });
    const { auth } = renderWithApp(<SettingsPage />, { api });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.type(await screen.findByLabelText('Type "delete" to confirm'), 'delete');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('The account was not deleted')).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
