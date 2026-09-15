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

  const baseCamera = {
    credentialRevoked: false,
    deviceId: 'device-1',
    deviceName: 'Pixel',
    enabled: true,
    facing: 'rear',
    id: 'camera-1',
    lastSeenAt: null,
    name: 'Rear camera',
    online: true,
    platform: 'android' as const,
    privacyMode: false,
    streaming: false,
    viewerCount: 0,
  };

  it('offers Remove when the viewer paired this camera themselves', () => {
    const onDelete = vi.fn();
    render(
      <CameraTile
        camera={{ ...baseCamera, canRemove: true, canLeave: true }}
        onOpen={() => undefined}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Rear camera options' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Remove camera' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('menuitem', { name: 'Leave this camera' }),
    ).not.toBeInTheDocument();
  });

  it('offers only Leave when a camera was shared with the viewer, not paired by them', () => {
    const onLeave = vi.fn();
    render(
      <CameraTile
        camera={{ ...baseCamera, canRemove: false, canLeave: true }}
        onOpen={() => undefined}
        onDelete={vi.fn()}
        onLeave={onLeave}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Rear camera options' }),
    );
    expect(
      screen.queryByRole('menuitem', { name: 'Remove camera' }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Leave this camera' }),
    );
    expect(onLeave).toHaveBeenCalledWith({
      ...baseCamera,
      canRemove: false,
      canLeave: true,
    });
  });

  it('shows no management menu for a camera the viewer can neither remove nor leave', () => {
    render(
      <CameraTile
        camera={{ ...baseCamera, canRemove: false, canLeave: false }}
        onOpen={() => undefined}
        onDelete={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Rear camera options' }),
    ).not.toBeInTheDocument();
  });
});
