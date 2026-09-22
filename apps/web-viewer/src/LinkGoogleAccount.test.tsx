import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LinkGoogleAccount } from './LinkGoogleAccount';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

it('shows a linked badge and no link action when already linked', () => {
  render(<LinkGoogleAccount linked />);
  expect(screen.getByText('Linked')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: 'Link Google' }),
  ).not.toBeInTheDocument();
});

it('offers a Link Google action pointed at the backend flow when not linked', () => {
  render(<LinkGoogleAccount linked={false} />);
  expect(screen.getByRole('link', { name: 'Link Google' })).toHaveAttribute(
    'href',
    '/api/auth/google/link',
  );
});

it('does not offer a dead link when Google authentication is unavailable', () => {
  render(<LinkGoogleAccount linked={false} available={false} />);
  expect(screen.queryByRole('link', { name: 'Link Google' })).not.toBeInTheDocument();
  expect(screen.getByText('Unavailable')).toBeVisible();
});

it('shows a success notice from a googleLink=success redirect and scrubs the URL', () => {
  window.history.replaceState({}, '', '/settings?section=account&googleLink=success');
  render(<LinkGoogleAccount linked={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Google account linked');
  expect(window.location.search).toBe('?section=account');
});

it('shows a conflict notice from a googleLink=conflict redirect', () => {
  window.history.replaceState({}, '', '/?googleLink=conflict');
  render(<LinkGoogleAccount linked={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'already linked to a different Beacon account',
  );
});
