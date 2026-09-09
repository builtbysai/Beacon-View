import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadWorkspaces, Monitoring } from './Monitoring';

vi.mock('./LiveVideo', () => ({
  LiveVideo: ({
    camera,
    enabled,
  }: {
    camera: { name: string };
    enabled: boolean;
  }) => <div data-enabled={enabled}>Stream for {camera.name}</div>,
}));

const cameras = [
  {
    credentialRevoked: false,
    deviceId: 'device-1',
    deviceName: 'Hallway phone',
    enabled: true,
    id: 'camera-1',
    name: 'Hallway',
    online: true,
    platform: 'android' as const,
    streaming: true,
    viewerCount: 2,
  },
  {
    credentialRevoked: false,
    deviceId: 'device-2',
    deviceName: 'Garage browser',
    enabled: true,
    id: 'camera-2',
    name: 'Garage',
    online: false,
    platform: 'browser' as const,
    streaming: false,
    viewerCount: 0,
  },
];

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  vi.restoreAllMocks();
});

describe('Monitoring', () => {
  it('renders independent tiles, reported health, filters, and persisted layouts', () => {
    render(
      <Monitoring
        cameras={cameras}
        devices={[
          { id: 'device-1', name: 'Hallway phone' },
          { id: 'device-2', name: 'Garage browser' },
        ]}
        onDevice={vi.fn()}
        onSwitchSource={vi.fn()}
        storageKey="monitor-test"
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Home camera grid' }),
    ).toHaveAttribute('data-layout', '4');
    expect(screen.getByText('2 Cameras')).toBeVisible();
    expect(screen.getByText('1 Online')).toBeVisible();
    expect(screen.getByText('1 Offline')).toBeVisible();
    expect(screen.getByText('2 Viewers')).toBeVisible();
    expect(screen.getByText('Stream for Hallway')).toBeVisible();
    expect(screen.getByText('Camera offline')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Layout'), {
      target: { value: '2' },
    });
    expect(
      screen.getByRole('region', { name: 'Home camera grid' }),
    ).toHaveAttribute('data-layout', '2');

    fireEvent.change(screen.getByLabelText('Filter by platform'), {
      target: { value: 'browser' },
    });
    expect(screen.queryByText('Stream for Hallway')).not.toBeInTheDocument();
    expect(loadWorkspaces('monitor-test', []).at(0)?.layout).toBe(2);

    vi.spyOn(window, 'prompt').mockReturnValue('Night');
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(screen.getByRole('heading', { name: 'Night' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Workspace'), {
      target: { value: 'home' },
    });
    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible();
  });

  it('supports keyboard reorder and fullscreen Escape', () => {
    render(
      <Monitoring
        cameras={cameras.map((camera) => ({ ...camera, online: true }))}
        devices={[]}
        onDevice={vi.fn()}
        onSwitchSource={vi.fn()}
        storageKey="monitor-reorder"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Hallway later' }));
    expect(loadWorkspaces('monitor-reorder', []).at(0)?.cameraIds).toEqual([
      'camera-2',
      'camera-1',
    ]);
    fireEvent.dragStart(
      screen.getByRole('article', { name: 'Hallway camera tile' }),
    );
    fireEvent.drop(screen.getByRole('article', { name: 'Garage camera tile' }));
    expect(loadWorkspaces('monitor-reorder', []).at(0)?.cameraIds).toEqual([
      'camera-1',
      'camera-2',
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Hallway fullscreen' }),
    );
    expect(
      screen.getByRole('button', { name: 'Exit Hallway fullscreen' }),
    ).toBeVisible();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.getByRole('button', { name: 'Open Hallway fullscreen' }),
    ).toBeVisible();
  });

  it('suspends independent streams when the browser tab is hidden', () => {
    render(
      <Monitoring
        cameras={[cameras[0]!]}
        devices={[]}
        onDevice={vi.fn()}
        onSwitchSource={vi.fn()}
        storageKey="monitor-visibility"
      />,
    );
    expect(screen.getByText('Stream for Hallway')).toHaveAttribute(
      'data-enabled',
      'true',
    );
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByText('Stream for Hallway')).toHaveAttribute(
      'data-enabled',
      'false',
    );
  });

  it('switches only the selected tile source', async () => {
    const switchSource = vi.fn().mockResolvedValue(undefined);
    const sibling = {
      ...cameras[0]!,
      id: 'camera-1-front',
      name: 'Front camera',
      streaming: false,
    };
    render(
      <Monitoring
        cameras={[cameras[0]!, sibling]}
        devices={[]}
        onDevice={vi.fn()}
        onSwitchSource={switchSource}
        storageKey="monitor-switch"
      />,
    );

    fireEvent.change(screen.getByLabelText('Switch Hallway source'), {
      target: { value: sibling.id },
    });
    await waitFor(() => expect(switchSource).toHaveBeenCalledWith(sibling.id));
    await waitFor(() =>
      expect(loadWorkspaces('monitor-switch', []).at(0)?.cameraIds).toContain(
        sibling.id,
      ),
    );
  });
});
