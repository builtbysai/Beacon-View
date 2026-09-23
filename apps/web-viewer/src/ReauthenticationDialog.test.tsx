import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ReauthenticationDialog } from './ReauthenticationDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('confirms a password through the reauthentication contract', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  const onConfirmed = vi.fn();
  render(
    <ReauthenticationDialog onCancel={vi.fn()} onConfirmed={onConfirmed} />,
  );

  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct horse battery staple' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/reauth',
      expect.objectContaining({
        body: JSON.stringify({ password: 'correct horse battery staple' }),
        method: 'POST',
      }),
    ),
  );
  expect(onConfirmed).toHaveBeenCalledOnce();
});

it('keeps the dialog open and shows an incorrect-password response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: 'Incorrect password' }),
      ok: false,
      status: 401,
    }),
  );
  render(<ReauthenticationDialog onCancel={vi.fn()} onConfirmed={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'incorrect password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Incorrect password',
  );
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
});
