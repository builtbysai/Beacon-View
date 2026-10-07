import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { CameraUseCasePanel } from './CameraUseCasePanel';
import type { Camera } from './domain';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(request).mockReset();
});

function camera(overrides: Partial<Camera> = {}): Camera {
  return {
    credentialRevoked: false,
    deviceId: 'device-1',
    deviceName: 'Hallway phone',
    enabled: true,
    facing: 'rear',
    id: 'camera-1',
    lastSeenAt: null,
    name: 'Hallway',
    online: true,
    platform: 'android',
    streaming: false,
    viewerCount: 0,
    ...overrides,
  };
}

describe('CameraUseCasePanel', () => {
  it('applies a use case and refreshes motion settings for Android', async () => {
    vi.mocked(request).mockResolvedValue({
      motionPresetApplied: true,
      useCase: 'doorbell',
    });
    const onApplied = vi.fn();
    render(<CameraUseCasePanel cameras={[camera()]} onApplied={onApplied} />);
    fireEvent.change(screen.getByLabelText('This camera'), {
      target: { value: 'doorbell' },
    });
    expect(
      await screen.findByText(/Motion settings below were updated/),
    ).toBeVisible();
    expect(request).toHaveBeenCalledWith('/api/cameras/camera-1/use-case', {
      body: JSON.stringify({ useCase: 'doorbell' }),
      method: 'PUT',
    });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/most responsive alerts and clips/)).toBeVisible();
  });

  it('never promises motion alerts for a computer camera', async () => {
    vi.mocked(request).mockResolvedValue({
      motionPresetApplied: false,
      useCase: 'security',
    });
    render(
      <CameraUseCasePanel
        cameras={[camera({ platform: 'browser' })]}
        onApplied={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText('This camera'), {
      target: { value: 'security' },
    });
    expect(
      await screen.findByText(/set in Camera Mode on that computer/),
    ).toBeVisible();
    expect(screen.getByText(/turns on when you view it/)).toBeVisible();
    expect(screen.queryByText(/alerts you/)).not.toBeInTheDocument();
  });

  it('puts the previous choice back when saving fails', async () => {
    vi.mocked(request).mockRejectedValue(new Error('offline'));
    render(
      <CameraUseCasePanel
        cameras={[camera({ useCase: 'baby' })]}
        onApplied={() => undefined}
      />,
    );
    const select = screen.getByLabelText('This camera');
    expect(select).toHaveValue('baby');
    fireEvent.change(select, { target: { value: 'security' } });
    expect(await screen.findByText('Couldn’t save. Try again.')).toBeVisible();
    expect(select).toHaveValue('baby');
  });
});
