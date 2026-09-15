import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { FormEvent } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
it('preserves OAuth collision guidance, password visibility, and registration guidance', () => {
  window.history.replaceState({}, '', '/?googleSignIn=linkRequired');
  const onMode = vi.fn();
  const props = { busy: false, error: '', onSubmit: vi.fn(), onMode };
  const view = render(<AuthScreen {...props} mode="login" />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'link Google from Settings',
  );
  expect(screen.getByLabelText('Password')).toHaveAttribute(
    'autocomplete',
    'current-password',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
  fireEvent.click(
    screen.getByRole('button', { name: 'Create a password account' }),
  );
  expect(onMode).toHaveBeenCalledOnce();
  view.rerender(<AuthScreen {...props} mode="register" />);
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Password')).toHaveAttribute(
    'autocomplete',
    'new-password',
  );
  expect(screen.getByText('Use at least 12 characters.')).toBeVisible();
});
it('blocks registration submit until the confirm-password field matches', () => {
  const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) =>
    event.preventDefault(),
  );
  render(
    <AuthScreen
      busy={false}
      error=""
      mode="register"
      onMode={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'a very long password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'a different password' },
  });
  expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
  expect(screen.getByText("Passwords don't match.")).toBeVisible();

  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'a very long password' },
  });
  expect(
    screen.getByRole('button', { name: 'Create account' }),
  ).not.toBeDisabled();
  expect(screen.queryByText("Passwords don't match.")).not.toBeInTheDocument();
});
it('requests a password reset without revealing whether the email exists', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ requested: true }),
    ok: true,
    status: 202,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <AuthScreen
      busy={false}
      error=""
      mode="login"
      onMode={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  fireEvent.change(screen.getByPlaceholderText('Enter your account email'), {
    target: { value: 'someone@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/request',
      expect.objectContaining({
        body: JSON.stringify({ email: 'someone@example.com' }),
        method: 'POST',
      }),
    ),
  );
  expect(await screen.findByRole('status')).toHaveTextContent(
    'If an account exists for that email, check your inbox',
  );
});
