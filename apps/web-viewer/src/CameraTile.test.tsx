import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CameraTile } from './CameraTile';

afterEach(cleanup);

describe('CameraTile', () => {
  it('offers device-bound reconnect from an offline camera menu', () => {
    const reconnect = vi.fn();
    const camera = {
      credentialRevoked: true,
      deviceId: 'device-1',
      deviceName: 'Pixel',
      enabled: true,
      facing: 'rear',
      id: 'camera-1',
      lastSeenAt: null,
      name: 'Rear camera',
      online: false,
      platform: 'android' as const,
      privacyMode: false,
      streaming: false,
      viewerCount: 0,
    };

    render(
      <CameraTile
        camera={camera}
        groupedByHost
        onOpen={() => undefined}
        onReconnect={reconnect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pixel options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reconnect camera' }));

    expect(reconnect).toHaveBeenCalledWith(camera);
  });
});
