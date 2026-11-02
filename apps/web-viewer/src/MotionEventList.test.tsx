import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  it('closes household details when household activity eligibility is removed', async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/activity')
          ? {
              ...response([]),
              json: () =>
                Promise.resolve({
                  events: [
                    {
                      id: 'household-detail',
                      eventType: 'device_offline',
                      occurredAt: new Date().toISOString(),
                      deviceName: 'Private household device',
                      metadata: {},
                    },
                  ],
                  total: 1,
                }),
            }
          : response([]),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <MotionEventList {...props} includeHouseholdActivity />,
    );
    fireEvent.click(await screen.findByText('Device went offline'));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Private household device',
    );
    view.rerender(
      <MotionEventList {...props} includeHouseholdActivity={false} />,
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText('Private household device'),
    ).not.toBeInTheDocument();
  });

  it('discards pending household history when household activity eligibility changes', async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn((url: string) =>
      url.startsWith('/api/activity')
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(response([event('authorized-motion')])),
    );
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <MotionEventList {...props} includeHouseholdActivity />,
    );
    view.rerender(
      <MotionEventList {...props} includeHouseholdActivity={false} />,
    );
    await screen.findByText('authorized-motion');
    await act(async () => {
      resolve({
        ...response([]),
        json: () =>
          Promise.resolve({
            events: [
              {
                id: 'stale-household',
                eventType: 'device_offline',
                occurredAt: new Date().toISOString(),
                deviceName: 'Private household device',
                metadata: {},
              },
            ],
            total: 1,
          }),
      });
      await Promise.resolve();
    });
    expect(
      screen.queryByText('Private household device'),
    ).not.toBeInTheDocument();
    expect(
      fetch.mock.calls.filter(([url]) => url.startsWith('/api/activity')),
    ).toHaveLength(1);
  });

  it('sends a custom local date boundary to both histories and subsequent pages', async () => {
    localStorage.setItem('motion-test:time', 'since');
    localStorage.setItem('motion-test:since', '2026-09-01');
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/activity')
          ? {
              ...response([]),
              json: () => Promise.resolve({ events: [], total: 0 }),
            }
          : response(
              [event(url.includes('cursor=') ? 'second' : 'first')],
              url.includes('cursor=') ? null : 'next',
            ),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} includeHouseholdActivity />);
    await screen.findByText('first');
    expect(screen.getByLabelText('Since date')).toHaveValue('2026-09-01');
    expect(
      screen.getByRole('option', { name: 'Hallway phone · Rear camera' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('second');
    for (const [url] of fetch.mock.calls) {
      expect(
        new URL(url, 'https://beacon.test').searchParams.get('since'),
      ).toBe(new Date(2026, 8, 1).toISOString());
    }
    const count = fetch.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Since date'), {
      target: { value: '' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a valid start date.',
    );
    expect(fetch).toHaveBeenCalledTimes(count);
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('searches additional pages, trims text, and resets all filters', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([event('first')], 'next'))
      .mockResolvedValueOnce(response([event('matching')]))
      .mockResolvedValue(response([event('reset')]));
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} />);
    await screen.findByText('first');
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Search loaded activity' }),
      { target: { value: '  matching  ' } },
    );
    expect(
      screen.getByText(/Load more to check additional events/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('matching');
    expect(screen.getByRole('status')).toHaveTextContent('1 event loaded');
    expect(screen.queryByText('first')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter activity by time'), {
      target: { value: '30' },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const since = new URL(
      fetch.mock.calls[2]![0] as string,
      'https://beacon.test',
    ).searchParams.get('since')!;
    expect(
      Math.abs(Date.now() - new Date(since).getTime() - 30 * 86_400_000),
    ).toBeLessThan(2000);
    fireEvent.change(screen.getByLabelText('Sort activity'), {
      target: { value: 'old' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Motion \d+$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(await screen.findByText('reset')).toBeVisible();
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByLabelText('Filter activity by time')).toHaveValue('24');
    expect(screen.getByLabelText('Sort activity')).toHaveValue('new');
    expect(screen.getByRole('button', { name: /^All / })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('queries recording history beyond the default timeline and keeps filters on later pages', async () => {
    localStorage.setItem('motion-test:camera', 'camera-one');
    localStorage.setItem('motion-test:time', 'all');
    const householdEvent = (
      id: string,
      eventType: string,
      occurredAt: string,
    ) => ({
      id,
      eventType,
      occurredAt,
      cameraSourceId: 'camera-one',
      deviceName: 'Hallway phone',
      sourceName: 'Rear camera',
      metadata: {},
    });
    const fetch = vi.fn((url: string) => {
      const params = new URL(url, 'https://beacon.test').searchParams;
      if (!url.startsWith('/api/activity'))
        return Promise.resolve(response([event('motion-only')]));
      const recordings = params
        .getAll('eventType')
        .includes('recording_failed');
      return Promise.resolve({
        ...response([]),
        json: () =>
          Promise.resolve({
            events: !recordings
              ? []
              : params.get('offset') === '0'
                ? [
                    householdEvent(
                      'failed-clip',
                      'recording_failed',
                      new Date().toISOString(),
                    ),
                  ]
                : [
                    householdEvent(
                      'ready-clip',
                      'recording_available',
                      new Date(Date.now() - 60_000).toISOString(),
                    ),
                  ],
            total: recordings ? 2 : 0,
          }),
      });
    });
    vi.stubGlobal('fetch', fetch);
    render(<MotionEventList {...props} includeHouseholdActivity />);
    await screen.findByText('motion-only');
    const initialMotionCalls = fetch.mock.calls.filter(([url]) =>
      url.startsWith('/api/motion-events'),
    ).length;
    fireEvent.click(screen.getByRole('button', { name: /^Recordings/ }));
    await screen.findByText('Recording failed');
    expect(screen.queryByText('motion-only')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('Recording available');
    const pages = fetch.mock.calls
      .map(([url]) => new URL(url, 'https://beacon.test'))
      .filter(
        (url) =>
          url.pathname === '/api/activity' && url.searchParams.has('eventType'),
      );
    expect(pages.map((url) => url.searchParams.get('offset'))).toEqual([
      '0',
      '1',
    ]);
    for (const page of pages) {
      expect(page.searchParams.get('cameraId')).toBe('camera-one');
      expect(page.searchParams.has('since')).toBe(false);
      expect(page.searchParams.getAll('eventType')).toContain(
        'recording_available',
      );
      expect(page.searchParams.getAll('eventType')).not.toContain(
        'device_offline',
      );
    }
    expect(
      fetch.mock.calls.filter(([url]) => url.startsWith('/api/motion-events')),
    ).toHaveLength(initialMotionCalls);
  });

  it('returns to authorized motion history when a selected security filter loses administrator access', async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/activity')
          ? {
              ...response([]),
              json: () =>
                Promise.resolve({
                  events: [
                    {
                      id: 'privacy-event',
                      eventType: 'privacy_enabled',
                      occurredAt: new Date().toISOString(),
                      metadata: {},
                    },
                  ],
                  total: 1,
                }),
            }
          : response([event('allowed-motion', new Date().toISOString())]),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const view = render(
      <MotionEventList {...props} includeHouseholdActivity />,
    );
    await screen.findByText('allowed-motion');
    fireEvent.click(screen.getByRole('button', { name: /^Security/ }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(([url]) =>
          new URL(url, 'https://beacon.test').searchParams
            .getAll('eventType')
            .includes('privacy_enabled'),
        ),
      ).toBe(true),
    );
    await screen.findByText('Privacy mode enabled');
    const privateCalls = fetch.mock.calls.filter(([url]) =>
      url.startsWith('/api/activity'),
    ).length;
    view.rerender(
      <MotionEventList {...props} includeHouseholdActivity={false} />,
    );
    await screen.findByText('allowed-motion');
    expect(screen.queryByText('Privacy mode enabled')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Security/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Motion \d+$/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      fetch.mock.calls.filter(([url]) => url.startsWith('/api/activity')),
    ).toHaveLength(privateCalls);
  });

  it.each([
    ['upload_failed', 'The clip could not be uploaded.'],
    [
      'private-provider-error-with-sensitive-data',
      'No recognized reason was recorded.',
    ],
    ['__proto__', 'No recognized reason was recorded.'],
  ])(
    'shows a safe failure reason for %s without treating audit success as clip success',
    async (reason, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            url.startsWith('/api/activity')
              ? {
                  ...response([]),
                  json: () =>
                    Promise.resolve({
                      events: [
                        {
                          id: 'failure-detail',
                          eventType: 'recording_failed',
                          occurredAt: new Date().toISOString(),
                          success: true,
                          metadata: {
                            reason,
                            token: 'sensitive-share-token',
                            providerError:
                              'private-provider-error-with-sensitive-data',
                          },
                        },
                      ],
                      total: 1,
                    }),
                }
              : response([]),
          ),
        ),
      );
      render(<MotionEventList {...props} includeHouseholdActivity />);
      fireEvent.click(await screen.findByText('Recording failed'));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Recorded outcome')).toBeVisible();
      expect(
        within(dialog).getAllByText('Recording failed').length,
      ).toBeGreaterThan(0);
      expect(dialog).toHaveTextContent(message);
      expect(dialog.innerHTML).not.toContain('sensitive-share-token');
      expect(dialog.innerHTML).not.toContain(
        'private-provider-error-with-sensitive-data',
      );
      expect(within(dialog).queryByText('Succeeded')).not.toBeInTheDocument();
    },
  );

  it.each([
    '2030-03-10T12:00:00.000Z',
    'https://private.example/sensitive-share-token',
    '2030-02-30T12:00:00.000Z',
  ])(
    'describes share expiry as historical information and never exposes share metadata (%s)',
    async (expiresAt) => {
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) =>
          Promise.resolve(
            url.startsWith('/api/activity')
              ? {
                  ...response([]),
                  json: () =>
                    Promise.resolve({
                      events: [
                        {
                          id: 'share-detail',
                          eventType: 'recording_share_link_created',
                          occurredAt: new Date().toISOString(),
                          metadata: {
                            expiresAt,
                            token: 'sensitive-share-token',
                            url: 'https://private.example/sensitive-share-token',
                          },
                        },
                      ],
                      total: 1,
                    }),
                }
              : response([]),
          ),
        ),
      );
      render(<MotionEventList {...props} includeHouseholdActivity />);
      fireEvent.click(await screen.findByText('Recording share link created'));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Recorded link expiry')).toBeVisible();
      expect(dialog).toHaveTextContent('may have expired or been revoked');
      expect(dialog).toHaveTextContent(
        expiresAt === '2030-03-10T12:00:00.000Z' ? '2030' : 'Not recorded',
      );
      expect(dialog.innerHTML).not.toContain('sensitive-share-token');
      expect(dialog.innerHTML).not.toContain('private.example');
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Back to activity' }),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('restores a saved legacy week filter as seven days', async () => {
    localStorage.setItem('motion-test:time', 'week');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])));
    render(<MotionEventList {...props} />);
    expect(await screen.findByRole('combobox', { name: /time/i })).toHaveValue(
      '7',
    );
    expect(localStorage.getItem('motion-test:time')).toBe('7');
  });

  it('shows structured household activity alongside motion without claiming object detection', async () => {
    const occurredAt = new Date().toISOString();
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/activity')
          ? {
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  events: [
                    {
                      id: 'offline-event',
                      actorEmail: null,
                      householdId: 'household-one',
                      publicDeviceId: 'device-one',
                      cameraSourceId: null,
                      deviceName: 'Hallway phone',
                      sourceName: null,
                      eventType: 'device_offline',
                      occurredAt,
                      success: true,
                      metadata: { deviceId: 'device-one' },
                    },
                  ],
                  total: 1,
                }),
            }
          : response([event('motion-event', occurredAt)]),
      ),
    );
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
    expect(
      fetch.mock.calls.some(
        ([url]) =>
          url.startsWith('/api/activity?limit=50&since=') &&
          url.endsWith('&offset=0'),
      ),
    ).toBe(true);
  });

  it('filters and opens household activity by the structured source ID', async () => {
    const occurredAt = new Date().toISOString();
    const fetch = vi.fn((url: string) =>
      Promise.resolve(
        url.startsWith('/api/activity')
          ? {
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  events: [
                    {
                      id: 'renamed',
                      actorEmail: 'owner@example.com',
                      householdId: 'household-one',
                      publicDeviceId: 'device-one',
                      cameraSourceId: 'camera-one',
                      deviceName: 'Hallway phone',
                      sourceName: 'Entry view',
                      eventType: 'camera_updated',
                      occurredAt,
                      success: true,
                      metadata: {},
                    },
                  ],
                  total: 1,
                }),
            }
          : response([]),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const onCamera = vi.fn();
    render(
      <MotionEventList
        {...props}
        onCamera={onCamera}
        includeHouseholdActivity
      />,
    );
    expect(await screen.findByText('Camera updated')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Filter activity by camera'), {
      target: { value: 'camera-one' },
    });
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url]) =>
            url.startsWith('/api/activity?') &&
            url.includes('cameraId=camera-one'),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('Camera updated')).toBeVisible();
    fireEvent.click(screen.getByText('Camera updated'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Entry view');
    expect(screen.getByRole('dialog')).toHaveTextContent('owner@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Open Hallway phone' }));
    expect(onCamera).toHaveBeenCalledWith('camera-one');
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

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('older');
    expect(screen.getAllByRole('region').length).toBeGreaterThan(0);
    const first = new URL(fetch.mock.calls[0]![0], 'https://beacon.test');
    const second = new URL(fetch.mock.calls[1]![0], 'https://beacon.test');
    expect(second.searchParams.get('since')).toBe(
      first.searchParams.get('since'),
    );
    expect(second.searchParams.get('cursor')).toBe('page-two');

    fireEvent.click(screen.getByText('newest'));
    fireEvent.click(screen.getAllByRole('button', { name: /Open / })[0]!);
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
    fireEvent.change(screen.getByLabelText('Filter activity by camera'), {
      target: { value: 'camera-two' },
    });
    await screen.findByText(/No activity matches these filters./);
    expect(fetch.mock.calls[0]![1].signal?.aborted).toBe(true);
    await act(async () => {
      resolve(response([event('stale')]));
      await Promise.resolve();
    });
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Filter activity by camera')).toHaveValue(
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
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
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
