import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client';
import { renderWithApp } from '../../test/render';
import { SignInPage } from './SignInPage';

const signedOut = { status: 'signedOut' } as const;

describe('SignInPage', () => {
  it('links to Google sign-in through the API', () => {
    renderWithApp(<SignInPage devLogin={false} />, { state: signedOut });
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      '/v1/auth/google/start',
    );
    expect(screen.queryByRole('button', { name: 'Dev sign-in' })).not.toBeInTheDocument();
  });

  it('explains a failed Google sign-in from the error code in the address', () => {
    renderWithApp(<SignInPage devLogin={false} />, {
      state: signedOut,
      route: '/sign-in?error=AUTH_NOT_CONFIGURED',
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Google sign-in is not set up on this server yet.',
    );
  });

  it('signs in with the dev login, and shows why it failed', async () => {
    const signInDev = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(429, 'RATE_LIMITED', 'Too many sign-in attempts.', 'req-9'),
      )
      .mockResolvedValueOnce(undefined);
    renderWithApp(<SignInPage devLogin />, { state: signedOut, auth: { signInDev } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dev sign-in' }));
    expect(await screen.findByText('Too many sign-in attempts.')).toBeInTheDocument();
    expect(screen.getByText('Request id: req-9')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dev sign-in' }));
    expect(signInDev).toHaveBeenLastCalledWith('dev@localhost', 'Local developer');
  });
});
