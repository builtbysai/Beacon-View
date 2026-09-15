import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailVerification } from './EmailVerification';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows a verified badge and never offers to resend when already verified', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<EmailVerification verified />);
  expect(screen.getByText('Verified')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: /Send verification email/ }),
  ).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('sends a verification email on request and confirms it was sent', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ requested: true }),
    ok: true,
    status: 202,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<EmailVerification verified={false} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Send verification email' }),
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/account/email/verify/request',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  expect(await screen.findByRole('button', { name: 'Sent' })).toBeDisabled();
  expect(
    screen.getByText('Check your inbox for a verification link.'),
  ).toBeVisible();
});

it('surfaces an error and allows retrying when the request fails', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 429,
    json: () => Promise.resolve({}),
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<EmailVerification verified={false} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Send verification email' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be sent',
  );
  expect(
    screen.getByRole('button', { name: 'Send verification email' }),
  ).not.toBeDisabled();
});
