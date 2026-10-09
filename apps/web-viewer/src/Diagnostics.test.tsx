import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { request } from './api';
import { Diagnostics } from './Diagnostics';

vi.mock('./api', () => ({ request: vi.fn() }));

it('aborts a pending connection check when leaving the page', () => {
  vi.mocked(request).mockImplementation(() => new Promise(() => {}));
  const view = render(<Diagnostics />);
  const options = vi.mocked(request).mock.calls[0]![1];
  expect(options?.signal?.aborted).toBe(false);
  view.unmount();
  expect(options?.signal?.aborted).toBe(true);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('copies only the reviewed sanitized report and refreshes the snapshot', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.mocked(request).mockResolvedValue({
    devices: [
      {
        deviceId: 'private-device',
        connectionState: 'offline',
        platform: 'android',
        lastHeartbeatAt: null,
      },
    ],
    cameras: [
      {
        cameraId: 'private-camera',
        captureState: 'idle',
        facing: 'rear',
        availability: 'offline',
        viewerCount: 0,
        viewerConnectionIds: ['private-connection'],
      },
    ],
  });
  render(<Diagnostics />);
  expect(
    await screen.findByText(/Check the camera device’s internet connection/),
  ).toBeVisible();
  fireEvent.click(screen.getByText('Preview report'));
  const preview = screen.getByRole('textbox', {
    name: 'Troubleshooting report',
  });
  expect((preview as HTMLTextAreaElement).value).not.toContain('private');
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Report copied');
  expect(writeText).toHaveBeenCalledWith(
    (preview as HTMLTextAreaElement).value,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
  expect(
    await screen.findByRole('button', { name: 'Copy report' }),
  ).toBeVisible();
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('keeps report text available when clipboard access fails', async () => {
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
    },
  });
  vi.mocked(request).mockResolvedValue({ devices: [], cameras: [] });
  render(<Diagnostics />);
  fireEvent.click(await screen.findByRole('button', { name: 'Copy report' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'copy it manually',
  );
  fireEvent.click(screen.getByText('Preview report'));
  expect(
    screen.getByRole('textbox', { name: 'Troubleshooting report' }),
  ).toHaveAttribute('readonly');
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

it('shows available diagnostics separately from a failed section and retries', async () => {
  vi.mocked(request)
    .mockResolvedValueOnce({
      unavailable: ['devices'],
      devices: [],
      cameras: [
        {
          cameraId: 'camera-1',
          captureState: 'streaming',
          facing: 'rear',
          viewerConnectionIds: ['connection-1'],
          viewerCount: 1,
        },
      ],
    })
    .mockResolvedValueOnce({ devices: [], cameras: [] });

  render(<Diagnostics />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Some diagnostics could not be loaded.',
  );
  expect(screen.getByText('Device diagnostics unavailable.')).toBeVisible();
  expect(screen.getByText('Capture: streaming')).toBeVisible();
  expect(screen.queryByText('No devices connected.')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No devices connected.')).toBeVisible();
  expect(screen.queryByText('Device diagnostics unavailable.')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});
