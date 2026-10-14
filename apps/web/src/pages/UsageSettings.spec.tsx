import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { UsageToday } from '../api/types';
import { fakeApi, renderWithApp } from '../test/render';
import { SettingsPage } from './SettingsPage';
import { UsagePage } from './UsagePage';

const TODAY: UsageToday = {
  day: '2026-10-14',
  plan: 'free',
  questions: { used: 12, limit: 50 },
  submissionsPerMinute: 10,
  finishedQuestions: 11,
  rowsReturned: 340,
  tokens: { input: 9000, output: 600 },
};

describe('UsagePage', () => {
  it("shows today's questions against the limit, and the totals", async () => {
    renderWithApp(<UsagePage />, {
      api: fakeApi({ get: vi.fn().mockResolvedValue(TODAY) }),
    });
    expect(await screen.findByText('12 of 50')).toBeInTheDocument();
    expect(screen.getByText(/38 left today/)).toBeInTheDocument();
    expect(screen.getByText('340')).toBeInTheDocument();
    expect(screen.getByText('9,600')).toBeInTheDocument();
    expect(
      screen.getByText(/up to 10 questions, queries, or re-runs a minute/),
    ).toBeInTheDocument();
  });

  it('says when the daily limit is reached', async () => {
    renderWithApp(<UsagePage />, {
      api: fakeApi({
        get: vi.fn().mockResolvedValue({ ...TODAY, questions: { used: 50, limit: 50 } }),
      }),
    });
    expect(await screen.findByText(/The daily limit is reached/)).toBeInTheDocument();
  });
});

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
