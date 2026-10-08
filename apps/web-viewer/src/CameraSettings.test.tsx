import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CameraSettings } from './CameraSettings';
import type { Camera, Device } from './domain';

afterEach(cleanup);

it('shows source metadata without offering controls the viewer cannot use', () => {
  const device: Device = {
    id: 'device-1',
    name: 'Pixel',
    platform: 'android',
    deviceType: 'phone',
    online: true,
    lastSeenAt: new Date().toISOString(),
    revoked: false,
    enabled: true,
    privacyMode: false,
    canRemove: false,
  };
  const cameras: Camera[] = ['rear', 'front'].map((facing) => ({
    id: facing,
    deviceId: device.id,
    deviceName: device.name,
    name: `${facing} camera`,
    online: true,
    platform: 'android',
    facing,
    enabled: true,
    streaming: false,
    viewerCount: 0,
    lastSeenAt: device.lastSeenAt,
    credentialRevoked: false,
    canFlip: false,
    canPause: false,
    capabilities: facing === 'rear' ? { zoom: true } : {},
  }));
  const { container } = render(
    <CameraSettings
      cameras={cameras}
      device={device}
      error="The camera could not be updated."
      canManageSettings={false}
      onBack={vi.fn()}
      onLive={vi.fn()}
      onDelete={vi.fn()}
      onPrivacy={vi.fn()}
      onRename={vi.fn()}
      onCameraRename={vi.fn()}
      onCameraDelete={vi.fn()}
      onSwitchSource={vi.fn()}
    />,
  );

  expect(screen.getByText('Rear source')).toBeVisible();
  expect(screen.getByText('zoom')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The camera could not be updated.',
  );
  expect(screen.queryByRole('switch', { name: 'Device privacy' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Motion' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Rename this camera' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: /Switch camera/ })).toBeNull();
  expect(screen.getAllByText('Online')).toHaveLength(1);
  expect(container.querySelector('.video-frame')).toBeNull();
});
