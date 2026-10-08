import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { request } from './api';
import { NotificationSettings } from './NotificationSettings';
import {
  AutosaveIndicator,
  SettingsAutosaveProvider,
} from './SettingsAutosave';

vi.mock('./api', () => ({ request: vi.fn() }));

afterEach(cleanup);

function renderNotificationSettings() {
  return render(
    <SettingsAutosaveProvider>
      <AutosaveIndicator />
      <NotificationSettings />
    </SettingsAutosaveProvider>,
  );
}

describe('NotificationSettings', () => {
  beforeEach(() => {
    vi.mocked(request)
      .mockReset()
      .mockResolvedValue({
        preferences: [
          {
            deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
            deviceName: 'Hallway camera',
            motionEnabled: false,
            offlineEnabled: false,
            quietHours: null,
          },
        ],
      });
  });

  it('loads disabled-by-default preferences without prompting for permission', async () => {
    const permission = vi.fn();
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: { requestPermission: permission },
    });
    renderNotificationSettings();
    expect(await screen.findByText('Hallway camera')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Motion alerts for Hallway camera' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('switch', {
        name: 'Offline and recovery alerts for Hallway camera',
      }),
    ).not.toBeChecked();
    expect(permission).not.toHaveBeenCalled();
  });

  it('autosaves a preference change immediately, with no Save button', async () => {
    vi.mocked(request).mockImplementation((path) => {
      if (path === '/api/notification-preferences') {
        return Promise.resolve({
          preferences: [
            {
              deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
              deviceName: 'Hallway camera',
              motionEnabled: false,
              offlineEnabled: false,
              quietHours: null,
            },
          ],
        });
      }
      if (
        path ===
        '/api/notification-preferences/8dc18bea-7a3b-48ad-b48a-48d00f975f54'
      ) {
        return Promise.resolve({
          preference: {
            deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
            deviceName: 'Hallway camera',
            motionEnabled: true,
            offlineEnabled: false,
            quietHours: null,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${String(path)}`));
    });
    renderNotificationSettings();
    const motion = await screen.findByRole('switch', {
      name: 'Motion alerts for Hallway camera',
    });
    expect(
      screen.queryByRole('button', { name: 'Save changes' }),
    ).not.toBeInTheDocument();

    fireEvent.click(motion);
    expect(motion).toBeChecked();
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/api/notification-preferences/8dc18bea-7a3b-48ad-b48a-48d00f975f54',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(await screen.findByText('Saved')).toBeVisible();
  });

  it('serializes edits to one camera and keeps the latest controls visible', async () => {
    const base = {
      deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
      deviceName: 'Hallway camera',
      motionEnabled: false,
      offlineEnabled: false,
      quietHours: null,
    };
    let finishFirst: ((value: { preference: typeof base }) => void) | undefined;
    const requests: string[] = [];
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/notification-preferences')
        return Promise.resolve({ preferences: [base] });
      const body = options?.body as string;
      requests.push(body);
      if (requests.length === 1)
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      const updated = JSON.parse(body) as {
        motionEnabled: boolean;
        offlineEnabled: boolean;
        quietHours: null;
      };
      return Promise.resolve({ preference: { ...base, ...updated } });
    });
    renderNotificationSettings();
    const motion = await screen.findByRole('switch', {
      name: 'Motion alerts for Hallway camera',
    });
    const offline = screen.getByRole('switch', {
      name: 'Offline and recovery alerts for Hallway camera',
    });
    fireEvent.click(motion);
    fireEvent.click(offline);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(motion).toBeChecked();
    expect(offline).toBeChecked();
    finishFirst!({ preference: { ...base, motionEnabled: true } });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(JSON.parse(requests[1]!)).toMatchObject({
      motionEnabled: true,
      offlineEnabled: true,
    });
    expect(motion).toBeChecked();
    expect(offline).toBeChecked();
  });

  it('autosaves Quiet Hours and reloads the saved time zone and window', async () => {
    type QuietHours = { start: string; end: string; timeZone: string };
    let savedQuietHours: QuietHours | null = null;
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/notification-preferences') {
        return Promise.resolve({
          preferences: [
            {
              deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
              deviceName: 'Hallway camera',
              motionEnabled: false,
              offlineEnabled: false,
              quietHours: savedQuietHours,
            },
          ],
        });
      }
      if (
        path.includes('/api/notification-preferences/') &&
        options?.method === 'PUT'
      ) {
        if (typeof options.body !== 'string') {
          throw new Error('Expected a serialized preference body');
        }
        const body = JSON.parse(options.body) as {
          quietHours: QuietHours | null;
        };
        savedQuietHours = body.quietHours;
        return Promise.resolve({
          preference: {
            deviceId: '8dc18bea-7a3b-48ad-b48a-48d00f975f54',
            deviceName: 'Hallway camera',
            motionEnabled: false,
            offlineEnabled: false,
            quietHours: savedQuietHours,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${String(path)}`));
    });

    const first = renderNotificationSettings();
    fireEvent.click(
      await screen.findByRole('switch', {
        name: 'Quiet hours for Hallway camera',
      }),
    );
    await waitFor(() => expect(savedQuietHours).not.toBeNull());
    expect(await screen.findByText('Saved')).toBeVisible();
    expect(savedQuietHours).toMatchObject({ start: '22:00', end: '07:00' });

    first.unmount();
    renderNotificationSettings();
    expect(
      await screen.findByLabelText('Quiet hours start for Hallway camera'),
    ).toHaveValue('22:00');
    expect(
      screen.getByLabelText('Quiet hours end for Hallway camera'),
    ).toHaveValue('07:00');
    expect(
      screen.getByText(
        `Time zone: ${savedQuietHours!.timeZone.replace(/_/g, ' ')}`,
      ),
    ).toBeVisible();
  });

  it('shows a retryable error instead of an empty-camera message when preferences fail to load', async () => {
    vi.mocked(request)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ preferences: [] });
    renderNotificationSettings();
    expect(
      await screen.findByText('Notification settings could not be loaded.', {
        exact: false,
      }),
    ).toBeVisible();
    expect(screen.queryByText(/Pair a camera/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Pair a camera/)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not offer a dead browser notification action when Web Push is unavailable', async () => {
    render(
      <SettingsAutosaveProvider>
        <NotificationSettings webPushAvailable={false} />
      </SettingsAutosaveProvider>,
    );
    expect(
      await screen.findByRole('button', { name: 'Unavailable' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Unavailable', { selector: '.pill' }),
    ).toBeVisible();
  });

  it('asks an older desktop app (no alert support) to update', async () => {
    window.beaconDesktop = { setCaptureActive: vi.fn(), version: 1 };
    try {
      renderNotificationSettings();
      expect(
        await screen.findByRole('button', { name: 'Unavailable' }),
      ).toBeDisabled();
      expect(
        screen.getByText(/Update the Beacon desktop app to receive alerts/),
      ).toBeVisible();
    } finally {
      delete window.beaconDesktop;
    }
  });

  it('turns desktop alerts on and off through the desktop channel', async () => {
    window.beaconDesktop = {
      setCaptureActive: vi.fn(),
      showAlert: vi.fn(),
      version: 1,
    };
    vi.mocked(request).mockImplementation((path, options) => {
      if (path === '/api/notification-preferences')
        return Promise.resolve({ preferences: [] });
      if (path === '/api/notification-subscriptions')
        return Promise.resolve({ id: 'desktop-subscription-1' });
      expect(options?.method).toBe('DELETE');
      return Promise.resolve(undefined);
    });
    try {
      renderNotificationSettings();
      expect(await screen.findByText('Desktop alerts')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
      expect(
        await screen.findByRole('button', { name: 'Turn off' }),
      ).toBeVisible();
      const subscribe = vi
        .mocked(request)
        .mock.calls.find(
          ([path]) => path === '/api/notification-subscriptions',
        );
      expect(JSON.parse(subscribe?.[1]?.body as string)).toMatchObject({
        channel: 'desktop',
        deviceLabel: 'Beacon desktop app',
      });
      expect(
        localStorage.getItem('beacon.notification.desktop-subscription.v1'),
      ).toBe('desktop-subscription-1');

      fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
      expect(
        await screen.findByRole('button', { name: 'Turn on' }),
      ).toBeVisible();
      expect(request).toHaveBeenCalledWith(
        '/api/notification-subscriptions/desktop-subscription-1',
        { method: 'DELETE' },
      );
      expect(
        localStorage.getItem('beacon.notification.desktop-subscription.v1'),
      ).toBeNull();
    } finally {
      delete window.beaconDesktop;
      localStorage.clear();
    }
  });
});
