import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResetPasswordPage } from './ResetPasswordPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('reports an invalid link immediately when the URL has no token', () => {
  window.history.replaceState({}, '', '/account/reset-password');
  render(<ResetPasswordPage />);
  expect(screen.getByText('That link is no longer valid.')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('rejects a mismatched confirmation before ever calling the API', () => {
  window.history.replaceState(
    {},
    '',
    '/account/reset-password?token=a-real-token',
  );
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<ResetPasswordPage />);
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'first new password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'different password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(screen.getByRole('alert')).toHaveTextContent('don’t match');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('submits a matching password and confirms every session was signed out', async () => {
  window.history.replaceState(
    {},
    '',
    '/account/reset-password?token=a-real-token',
  );
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  render(<ResetPasswordPage />);
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'a brand new password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'a brand new password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/confirm',
      expect.objectContaining({
        body: JSON.stringify({
          password: 'a brand new password',
          token: 'a-real-token',
        }),
        method: 'POST',
      }),
    ),
  );
  expect(await screen.findByText('Password updated.')).toBeVisible();
  expect(screen.getByText(/every other browser session/i)).toBeVisible();
});

it('surfaces the server error for an expired or reused token', async () => {
  window.history.replaceState(
    {},
    '',
    '/account/reset-password?token=an-expired-token',
  );
  const fetchMock = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ error: 'Invalid or expired reset link' }),
    ok: false,
    status: 400,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ResetPasswordPage />);
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'a brand new password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'a brand new password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'That reset link has expired. Request a new one.',
  );
});
