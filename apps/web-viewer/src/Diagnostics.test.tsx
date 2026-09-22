import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { request } from './api';
import { Diagnostics } from './Diagnostics';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('recovers from a rejected diagnostics request without staying in loading state', async () => {
  vi.mocked(request)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ devices: [], cameras: [] });

  render(<Diagnostics />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Diagnostics could not be loaded.',
  );
  expect(
    screen.queryByText('Loading sanitized connection diagnostics...'),
  ).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('No devices connected.')).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(2);
});
