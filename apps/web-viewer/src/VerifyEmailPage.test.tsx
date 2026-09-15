import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VerifyEmailPage } from './VerifyEmailPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/account/verify-email');
});

it('confirms the token from the URL and reports success', async () => {
  window.history.replaceState(
    {},
    '',
    '/account/verify-email?token=a-real-token',
  );
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
  render(<VerifyEmailPage />);
  expect(await screen.findByText('Email verified.')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/account/email/verify/confirm',
    expect.objectContaining({
      body: JSON.stringify({ token: 'a-real-token' }),
      method: 'POST',
    }),
  );
});

it('reports an expired or invalid token without retrying automatically', async () => {
  window.history.replaceState(
    {},
    '',
    '/account/verify-email?token=an-expired-token',
  );
  const fetchMock = vi.fn().mockResolvedValue({
    json: () =>
      Promise.resolve({ error: 'Invalid or expired verification link' }),
    ok: false,
    status: 400,
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<VerifyEmailPage />);
  expect(
    await screen.findByText('That link is no longer valid.'),
  ).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('reports failure immediately when the URL has no token', () => {
  window.history.replaceState({}, '', '/account/verify-email');
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<VerifyEmailPage />);
  expect(screen.getByText('That link is no longer valid.')).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
