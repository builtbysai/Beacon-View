import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthScreen } from './AuthScreen';
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});
it('preserves OAuth collision guidance, password visibility, and registration guidance', () => {
  window.history.replaceState({}, '', '/?googleSignIn=linkRequired');
  const onMode = vi.fn();
  const props = { busy: false, error: '', onSubmit: vi.fn(), onMode };
  const view = render(<AuthScreen {...props} mode="login" />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Google account linking is not yet available',
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
  expect(
    screen.getByText(/Password-reset emails are not available yet/),
  ).toBeVisible();
});
it('offers an honest password recovery path without claiming reset delivery', () => {
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
  expect(screen.getByRole('status')).toHaveTextContent(
    'Reset email is not available',
  );
  expect(screen.getByRole('link', { name: 'contact support' })).toHaveAttribute(
    'href',
    '/contact',
  );
});
