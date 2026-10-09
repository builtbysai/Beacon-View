import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { RecordingLibrary } from './RecordingLibrary';

const playback = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./recording-playback', () => ({
  loadRecordingForPlayback: playback.load,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  playback.load.mockReset();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('keeps the authorized library usable when bookmark storage is corrupt or blocked', async () => {
  localStorage.setItem('blocked-bookmarks', '{invalid');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          recordings: [
            {
              id: 'clip',
              cameraName: 'Door',
              deviceName: 'Phone',
              status: 'available',
              createdAt: '2026-09-24T12:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Blocked', 'SecurityError');
  });
  render(<RecordingLibrary bookmarkStorageKey="blocked-bookmarks" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bookmark clip' }));
  expect(
    await screen.findByText(/this browser could not save them/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bookmarked only' }));
  expect(screen.getByRole('button', { name: 'Play clip' })).toBeVisible();
});

it('keeps bookmarks scoped and only shows authorized clips across reload and pagination', async () => {
  let allowed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            recordings: allowed
              ? [
                  {
                    id: path.includes('cursor=') ? 'older' : 'recent',
                    cameraId: 'camera',
                    cameraName: 'Door',
                    deviceName: 'Phone',
                    status: 'available',
                    createdAt: '2026-09-24T12:00:00Z',
                  },
                ]
              : [],
            nextCursor: !path.includes('cursor=') && allowed ? 'next' : null,
          }),
          { status: 200 },
        ),
      ),
    ),
  );
  const view = render(
    <RecordingLibrary key="a" bookmarkStorageKey="bookmarks-a" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Bookmark clip' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bookmarked only' }));
  expect(screen.getByRole('button', { name: 'Play clip' })).toBeVisible();
  view.rerender(<RecordingLibrary key="b" bookmarkStorageKey="bookmarks-b" />);
  expect(
    await screen.findByRole('button', { name: 'Bookmark clip' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bookmarked only' }));
  expect(
    screen.queryByRole('button', { name: 'Play clip' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByText('No clips match these filters.'),
  ).toBeVisible();
  view.rerender(
    <RecordingLibrary key="a-reload" bookmarkStorageKey="bookmarks-a" />,
  );
  expect(
    await screen.findByRole('button', { name: 'Remove bookmark' }),
  ).toBeVisible();
  allowed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('No recorded clips yet.')).toBeVisible();
  expect(playback.load).not.toHaveBeenCalled();
  expect(localStorage.getItem('bookmarks-a')).toBe('["recent"]');
});

it('opens and releases a decrypted recording from Activity', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          recordings: [
            {
              id: 'clip-1',
              cameraName: 'Front door',
              deviceName: 'Spare phone',
              status: 'available',
              createdAt: '2026-09-24T12:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  const createUrl = vi.fn().mockReturnValue('blob:beacon-clip');
  const revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeUrl,
  });
  playback.load.mockResolvedValue(new Blob(['private clip']));

  render(<RecordingLibrary />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play clip' }));
  expect(await screen.findByLabelText('Recorded clip')).toHaveAttribute(
    'src',
    'blob:beacon-clip',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close clip' }));
  expect(revokeUrl).toHaveBeenCalledWith('blob:beacon-clip');
});

it('labels and removes a failed recording', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          recordings: [
            {
              id: 'clip-failed',
              cameraName: 'Back door',
              deviceName: 'Pixel',
              status: 'failed',
              createdAt: '2026-09-25T12:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);

  render(<RecordingLibrary canDelete />);
  expect(await screen.findByText('Recording failed')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(await screen.findByText('No recorded clips yet.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/recordings/clip-failed',
    expect.objectContaining({ method: 'DELETE' }),
  );
});

it('hides delete controls for a viewer without delete access, but still allows playback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          recordings: [
            {
              id: 'clip-2',
              cameraName: 'Front door',
              deviceName: 'Spare phone',
              status: 'available',
              createdAt: '2026-09-24T12:00:00Z',
            },
            {
              id: 'clip-failed-2',
              cameraName: 'Back door',
              deviceName: 'Pixel',
              status: 'failed',
              createdAt: '2026-09-25T12:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );

  render(<RecordingLibrary />);
  await screen.findByRole('button', { name: 'Play clip' });
  expect(
    screen.queryByRole('button', { name: 'Delete clip' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Remove' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Download clip' }),
  ).toBeInTheDocument();
});
