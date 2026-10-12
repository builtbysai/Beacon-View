import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { DriveExpiredNotice } from './DriveExpiredNotice';

afterEach(cleanup);

it('reminds the owner to reconnect Drive and offers the fix on the spot', () => {
  const connect = vi.fn();
  const onDismiss = vi.fn();
  render(
    <DriveExpiredNotice
      drive={{ connect, connecting: false, state: 'expired' }}
      onDismiss={onDismiss}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    /new clips can't be saved/,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Reconnect Google Drive' }),
  );
  expect(connect).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onDismiss).toHaveBeenCalled();
});

it('shows nothing while Drive works or was never connected', () => {
  for (const state of [
    'ready',
    'checking',
    'not_connected',
    'unavailable',
  ] as const) {
    const { container } = render(
      <DriveExpiredNotice
        drive={{ connect: vi.fn(), connecting: false, state }}
        onDismiss={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    cleanup();
  }
});
