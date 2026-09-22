import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionEventList } from './MotionEventList';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const cameras = [
  { id: 'camera-one', name: 'Rear camera', deviceName: 'Hallway phone' },
  { id: 'camera-two', name: 'Front camera', deviceName: 'Kitchen phone' },
];
const event = (id: string, occurredAt = '2026-09-05T12:00:00Z') => ({
  id,
  occurredAt,
  cameraId: 'camera-one',
  cameraName: 'Rear camera',
  deviceName: id,
  confidence: 0.42,
});
const response = (
  events: ReturnType<typeof event>[],
  nextCursor: string | null = null,
) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ events, nextCursor }),
});
const props = {
  cameras,
  onCamera: vi.fn<(id: string) => void>(),
  filterStorageKey: 'motion-test',
  refreshRevision: 0,
  includeHouseholdActivity: false,
};

describe('Activity timeline', () => {
  it('shows structured household activity alongside motion without claiming object detection', async () => {
    const occurredAt = new Date().toISOString();
    const fetch = vi.fn((url: string) => Promise.resolve(
      url.startsWith('/api/activity')
        ? {
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              events: [{
                id: 'offline-event',
                actorEmail: null,
                deviceName: 'Hallway phone',
                eventType: 'device_offline',
                occurredAt,
                success: true,
                metadata: { deviceId: 'device-one' },
              }],
              total: 1,
            }),
          }
        : response([event('motion-event', occurredAt)]),
    ));
    vi.stubGlobal('fetch', fetch);

    render(<MotionEventList {...props} includeHouseholdActivity />);
    expect(await screen.findByText('Device went offline')).toBeVisible();
    expect(screen.getByText('Motion detected')).toBeVisible();
    expect(screen.queryByText('Person detected')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Device went offline'));
    const details = screen.getByRole('dialog');
    expect(details).toHaveTextContent('Device went offline');
    expect(details).not.toHaveTextContent('Motion intensity');
    expect(details).not.toHaveTextContent('Open Hallway phone');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/activity?limit=50&offset=0');
  });

  it('labels motion from the API as motion regardless of its event ID', async () => {
    const fetch = vi.fn().mockResolvedValue(response([event('ab')]));
    vi.stubGlobal('fetch', fetch);

    render(<MotionEventList {...props} />);

    await screen.findByText('ab');
    expect(screen.getByText('Motion detected')).toBeVisible();
    expect(screen.queryByText('Animal detected')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('ab'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Motion intensity');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Animal detected');
  });

  it('loads older events with stable filters, groups by day, and opens the source camera', async () => {
    const fetch = vi
      .fn<
        (
          url: string,
          options: RequestInit,
        ) => Promise<ReturnType<typeof response>>
      >()
      .mockResolvedValueOnce(response([event('newest')], 'page-two'))
      .mockResolvedValueOnce(
        response([event('older', '2026-09-04T12:00:00Z')]),
      );
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} />);
    await screen.findByText('newest');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    
    fireEvent.click(
      screen.getByRole('button', { name: 'Load more' }),
    );
    await screen.findByText('older');
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0);
    const first = new URL(fetch.mock.calls[0]![0], 'https://beacon.test');
    const second = new URL(fetch.mock.calls[1]![0], 'https://beacon.test');
    expect(second.searchParams.get('since')).toBe(
      first.searchParams.get('since'),
    );
    expect(second.searchParams.get('cursor')).toBe('page-two');
    
    fireEvent.click(screen.getByText('newest'));
    fireEvent.click(
      screen.getAllByRole('button', { name: /Open / })[0]!,
    );
    expect(props.onCamera).toHaveBeenCalledWith('camera-one');
  });

  it('automatically refreshes on new activity with no manual step, and resets on remote deletion', async () => {
    const fetch = vi
      .fn<
        (
          url: string,
          options: RequestInit,
        ) => Promise<ReturnType<typeof response>>
      >()
      .mockResolvedValueOnce(response([event('old')]))
      .mockResolvedValueOnce(response([event('new')]))
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetch);
    const view = render(<MotionEventList {...props} />);
    await screen.findByText('old');
    view.rerender(<MotionEventList {...props} refreshRevision={1} />);
    await screen.findByText('new');
    expect(screen.queryByText('old')).not.toBeInTheDocument();
    
    view.rerender(
      <MotionEventList {...props} refreshRevision={2} clearRevision={1} />,
    );
    await screen.findByText(/No activity matches these filters./);
    expect(screen.queryByText('new')).not.toBeInTheDocument();
  });

  it('ignores a late response after filter changes and never resets an empty camera filter', async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    const fetch = vi
      .fn<
        (
          url: string,
          options: RequestInit,
        ) => Promise<ReturnType<typeof response>>
      >()
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(response([]));
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} />);
    fireEvent.change(screen.getByLabelText('Filter motion events by camera'), {
      target: { value: 'camera-two' },
    });
    await screen.findByText(/No activity matches these filters./);
    expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
    await act(async () => {
      resolve(response([event('stale')]));
      await Promise.resolve();
    });
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter motion events by camera')).toHaveValue(
      'camera-two',
    );
    expect(fetch.mock.calls[1]![0]).toContain('cameraId=camera-two');
  });

  it('retains loaded activity and retries the failed next page without duplicate requests', async () => {
    const fetch = vi
      .fn<
        (
          url: string,
          options: RequestInit,
        ) => Promise<ReturnType<typeof response>>
      >()
      .mockResolvedValueOnce(response([event('first')], 'next'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response([event('second')]));
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} />);
    await screen.findByText('first');
    fireEvent.click(
      screen.getByRole('button', { name: 'Load more' }),
    );
    await screen.findByRole('alert');
    expect(screen.getByText('first')).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading activity' }),
    );
    await screen.findByText('second');
    expect(fetch.mock.calls[1]![0]).toBe(fetch.mock.calls[2]![0]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('works without browser storage and confirms all-history deletion', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const fetch = vi
      .fn<
        (
          url: string,
          options: RequestInit,
        ) => Promise<ReturnType<typeof response>>
      >()
      .mockResolvedValueOnce(response([event('saved')]))
      .mockResolvedValueOnce({ ...response([]), status: 204 });
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} />);
    await screen.findByText('saved');
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear motion history' }),
    );
    expect(
      await screen.findByText(/permanently deletes motion event metadata/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole('button', { name: 'Clear motion history' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Clear history' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('saved')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('status')).toHaveFocus();
    expect(fetch.mock.calls[1]![1].method).toBe('DELETE');
  });
});
