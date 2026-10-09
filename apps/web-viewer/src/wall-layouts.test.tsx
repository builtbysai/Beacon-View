import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraWall } from './CameraWall';
import type { Camera } from './domain';
import {
  layoutCameras,
  loadWallLayouts,
  saveWallLayouts,
  wallStorageKey,
} from './wall-layouts';

vi.mock('./LiveVideo', () => ({
  LiveVideo: ({ camera }: { camera: Camera }) => (
    <div data-testid="stream">{camera.id}</div>
  ),
}));
const camera = (id: string, online = true): Camera => ({
  id,
  deviceId: `device-${id}`,
  name: id,
  deviceName: `Phone ${id}`,
  online,
  enabled: true,
  credentialRevoked: false,
  streaming: false,
  viewerCount: 0,
  lastSeenAt: null,
  platform: 'android',
  facing: 'back',
});
const cameras = [camera('a'), camera('b'), camera('c', false)];
const key = wallStorageKey('owner', 'home');
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('IntersectionObserver', undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saved wall layouts', () => {
  it('isolates accounts and households and rejects corrupt stored preferences', () => {
    saveWallLayouts(key, [
      { name: 'Outside', deviceIds: ['device-a'], columns: 2 },
    ]);
    expect(loadWallLayouts(wallStorageKey('other', 'home'))).toEqual([]);
    expect(loadWallLayouts(wallStorageKey('owner', 'other'))).toEqual([]);
    localStorage.setItem(
      key,
      JSON.stringify([
        { name: 'bad', deviceIds: ['device-a', 'device-a'], columns: 2 },
        { name: 'bad columns', deviceIds: ['device-a'], columns: 7 },
      ]),
    );
    expect(loadWallLayouts(key)).toEqual([]);
    localStorage.setItem(key, '{');
    expect(loadWallLayouts(key)).toEqual([]);
  });

  it('uses only authorized inventory, preserves order, and follows active source changes', () => {
    expect(
      layoutCameras(cameras, ['device-b', 'revoked', 'device-a']).map(
        (item) => item.id,
      ),
    ).toEqual(['b', 'a']);
    expect(
      layoutCameras([{ ...camera('a'), id: 'front' }], ['device-a'])[0]?.id,
    ).toBe('front');
  });

  it('creates a group, reorders it, reloads it and removes it without modifying cameras', () => {
    const props = {
      cameras,
      storageKey: key,
      onBack: vi.fn(),
      onOpen: vi.fn(),
    };
    const view = render(<CameraWall {...props} />);
    fireEvent.click(screen.getByText('New group / layout'));
    fireEvent.change(screen.getByLabelText('Layout name'), {
      target: { value: 'Downstairs' },
    });
    fireEvent.click(screen.getByLabelText('c · Phone c'));
    fireEvent.click(screen.getByRole('button', { name: 'Move b earlier' }));
    fireEvent.change(screen.getByLabelText('Layout columns'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByText('Save layout'));
    expect(
      screen.getAllByTestId('stream').map((item) => item.textContent),
    ).toEqual(['b', 'a']);
    expect(loadWallLayouts(key)[0]).toEqual({
      name: 'Downstairs',
      deviceIds: ['device-b', 'device-a'],
      columns: 1,
    });
    view.unmount();
    render(<CameraWall {...props} />);
    // Opening the wall starts with All cameras; saved groups require a choice.
    fireEvent.change(screen.getByLabelText('Saved layout'), {
      target: { value: 'Downstairs' },
    });
    expect(
      screen.getAllByTestId('stream').map((item) => item.textContent),
    ).toEqual(['b', 'a']);
    fireEvent.click(screen.getByText('Delete layout'));
    expect(loadWallLayouts(key)).toEqual([]);
    expect(screen.getByLabelText('Saved layout')).toHaveValue('');
    expect(cameras).toHaveLength(3);
  });

  it('does not show or stream a saved device after access disappears', () => {
    saveWallLayouts(key, [
      { name: 'Outside', deviceIds: ['device-b'], columns: 'auto' },
    ]);
    const props = { storageKey: key, onBack: vi.fn(), onOpen: vi.fn() };
    const view = render(<CameraWall {...props} cameras={cameras} />);
    fireEvent.change(screen.getByLabelText('Saved layout'), {
      target: { value: 'Outside' },
    });
    expect(screen.getByTestId('stream')).toHaveTextContent('b');
    view.rerender(<CameraWall {...props} cameras={[cameras[0]!]} />);
    expect(screen.queryByTestId('stream')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '1 saved camera is no longer available to this account.',
      ),
    ).toBeInTheDocument();
  });

  it('limits groups to nine cameras and supports cancel and duplicate-name feedback', () => {
    saveWallLayouts(key, [
      { name: 'Outside', deviceIds: ['device-a'], columns: 2 },
    ]);
    render(
      <CameraWall
        cameras={Array.from({ length: 10 }, (_, index) =>
          camera(String(index)),
        )}
        storageKey={key}
        onBack={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('New group / layout'));
    const form = screen.getByRole('form', {
      name: 'Edit camera group and layout',
    });
    expect(within(form).getByLabelText('9 · Phone 9')).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Layout name'), {
      target: { value: 'outside' },
    });
    fireEvent.click(screen.getByText('Save layout'));
    expect(
      screen.getByText(/Choose a different layout name/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(loadWallLayouts(key)).toHaveLength(1);
  });

  it('keeps layout usable when storage is blocked and explains the limitation', () => {
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    render(
      <CameraWall
        cameras={cameras}
        storageKey={key}
        onBack={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('New group / layout'));
    fireEvent.change(screen.getByLabelText('Layout name'), {
      target: { value: 'Temporary' },
    });
    fireEvent.click(screen.getByText('Save layout'));
    expect(screen.getByLabelText('Saved layout')).toHaveValue('Temporary');
    expect(
      screen.getByText(/Browser storage is unavailable/),
    ).toBeInTheDocument();
    write.mockRestore();
  });
});
