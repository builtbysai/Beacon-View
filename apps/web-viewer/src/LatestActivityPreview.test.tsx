import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { request } from './api';
import { LatestActivityPreview } from './LatestActivityPreview';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('retries a failed Home preview and clears stale events after a failed refresh', async () => {
  const event = {
    id: 'event-1',
    cameraId: 'camera-1',
    cameraName: 'Rear camera',
    deviceName: 'Hallway phone',
    confidence: 0.8,
    occurredAt: '2026-09-23T12:00:00Z',
  };
  vi.mocked(request)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce({ events: [event] })
    .mockRejectedValueOnce(new Error('Unavailable'));
  const onCamera = vi.fn();
  const view = render(
    <LatestActivityPreview refreshRevision={0} onCamera={onCamera} />,
  );

  expect(
    await screen.findByText('Activity is temporarily unavailable.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  fireEvent.click(
    await screen.findByRole('button', { name: /Motion detected/ }),
  );
  expect(onCamera).toHaveBeenCalledWith('camera-1');

  view.rerender(
    <LatestActivityPreview refreshRevision={1} onCamera={onCamera} />,
  );
  expect(
    await screen.findByText('Activity is temporarily unavailable.'),
  ).toBeVisible();
  expect(screen.queryByText('Motion detected')).toBeNull();
  expect(request).toHaveBeenCalledTimes(3);
});
