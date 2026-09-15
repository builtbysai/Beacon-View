import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { request } from './api';
import { SetPassword } from './SetPassword';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, request: vi.fn() };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/');
});

it('auto-opens and scrubs the URL when arriving with ?addPassword=1', () => {
  window.history.replaceState(
    {},
    '',
    '/settings?section=account&addPassword=1',
  );
  render(<SetPassword onSet={vi.fn()} />);
  expect(screen.getByLabelText('New password')).toBeVisible();
  expect(window.location.search).toBe('?section=account');
});

it('opens the form, blocks a mismatched confirmation, then saves', async () => {
  vi.mocked(request).mockResolvedValue(undefined);
  const onSet = vi.fn();
  render(<SetPassword onSet={onSet} />);

  fireEvent.click(screen.getByRole('button', { name: 'Add password' }));
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'a brand new password' },
  });
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'not the same password' },
  });
  expect(screen.getByRole('button', { name: 'Save password' })).toBeDisabled();
  expect(screen.getByText("Passwords don't match.")).toBeVisible();

  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'a brand new password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/api/account/password/set', {
      body: JSON.stringify({ password: 'a brand new password' }),
      method: 'POST',
    }),
  );
  await waitFor(() => expect(onSet).toHaveBeenCalledOnce());
});
