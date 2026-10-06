import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { isDesktopShell } from './desktop-shell';
import { useSettingsAutosave } from './SettingsAutosave';
import { SettingsRow } from './SettingsUI';
import { Switch } from './Switch';
import { randomUuid } from './random-id';
import './NotificationSettings.css';

interface Preference {
  deviceId: string;
  deviceName: string;
  motionEnabled: boolean;
  offlineEnabled: boolean;
  quietHours: { start: string; end: string; timeZone: string } | null;
}

const REVEAL_INITIAL = 6;
const REVEAL_STEP = 6;

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  );
  return new Uint8Array(bytes.buffer);
}

function installationId(): string {
  const key = 'beacon.notification.installation.v1';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = randomUuid();
  localStorage.setItem(key, created);
  return created;
}

export async function disableWebNotifications(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await (
      await registration?.pushManager.getSubscription()
    )
      ?.unsubscribe()
      .catch(() => false);
  }
  const id = localStorage.getItem('beacon.notification.subscription.v1');
  if (id)
    await request(`/api/notification-subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  localStorage.removeItem('beacon.notification.subscription.v1');
}

export function NotificationSettings({
  webPushAvailable: serverWebPushAvailable = true,
}: {
  webPushAvailable?: boolean;
}) {
  // Electron has no push service, so the desktop app cannot hold a Web Push
  // subscription even though the API objects exist (ADR 0082).
  const desktopShell = isDesktopShell();
  const webPushAvailable = serverWebPushAvailable && !desktopShell;
  const { run } = useSettingsAutosave();
  const [preferences, setPreferences] = useState<Preference[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState('');
  const [preferencesError, setPreferencesError] = useState(false);
  const [visible, setVisible] = useState(REVEAL_INITIAL);
  const latestPreferences = useRef<Preference[]>([]);
  const confirmedPreferences = useRef(new Map<string, Preference>());
  const saveChains = useRef(new Map<string, Promise<void>>());
  const editVersions = useRef(new Map<string, number>());

  function loadPreferences() {
    setPreferencesError(false);
    setPreferences(null);
    void request<{ preferences: Preference[] }>('/api/notification-preferences')
      .then((result) => {
        latestPreferences.current = result.preferences;
        confirmedPreferences.current = new Map(
          result.preferences.map((item) => [item.deviceId, item]),
        );
        setPreferences(result.preferences);
      })
      .catch(() => {
        setPreferencesError(true);
        setPreferences([]);
      });
  }

  useEffect(() => {
    loadPreferences();
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration('/')
        .then(async (registration) => {
          setEnabled(
            Boolean(await registration?.pushManager.getSubscription()),
          );
        });
    }
  }, []);

  async function enableChannel() {
    setChannelBusy(true);
    setChannelError('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        throw new Error('This browser does not support notifications.');
      if ((await Notification.requestPermission()) !== 'granted')
        throw new Error(
          'Notifications were not allowed. Change this in your browser settings.',
        );
      const config = await request<{ publicKey: string }>(
        '/api/notification-config/web-push-key',
      );
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      const subscription = await registration.pushManager.subscribe({
        applicationServerKey: applicationServerKey(config.publicKey),
        userVisibleOnly: true,
      });
      const result = await request<{ id: string }>(
        '/api/notification-subscriptions',
        {
          method: 'POST',
          body: JSON.stringify({
            channel: 'web_push',
            installationId: installationId(),
            deviceLabel: 'Beacon web viewer',
            subscription: subscription.toJSON(),
          }),
        },
      ).catch(async (error: unknown) => {
        await subscription.unsubscribe().catch(() => false);
        throw error;
      });
      localStorage.setItem('beacon.notification.subscription.v1', result.id);
      setEnabled(true);
    } catch (error) {
      setChannelError(
        error instanceof Error
          ? error.message
          : 'Notifications could not be enabled.',
      );
    } finally {
      setChannelBusy(false);
    }
  }

  async function disableChannel() {
    setChannelBusy(true);
    setChannelError('');
    try {
      await disableWebNotifications();
      setEnabled(false);
    } finally {
      setChannelBusy(false);
    }
  }

  function updatePreference(
    deviceId: string,
    update: (preference: Preference) => Preference,
  ) {
    const current = latestPreferences.current.find(
      (item) => item.deviceId === deviceId,
    );
    if (!current) return;
    const next = update(current);
    const version = (editVersions.current.get(deviceId) ?? 0) + 1;
    editVersions.current.set(deviceId, version);
    latestPreferences.current = latestPreferences.current.map((item) =>
      item.deviceId === deviceId ? next : item,
    );
    setPreferences(latestPreferences.current);
    run(async () => {
      const prior = saveChains.current.get(deviceId) ?? Promise.resolve();
      const save = prior
        .catch(() => undefined)
        .then(async () => {
          const result = await request<{ preference: Preference }>(
            `/api/notification-preferences/${encodeURIComponent(deviceId)}`,
            {
              method: 'PUT',
              body: JSON.stringify({
                motionEnabled: next.motionEnabled,
                offlineEnabled: next.offlineEnabled,
                quietHours: next.quietHours,
              }),
            },
          );
          confirmedPreferences.current.set(deviceId, result.preference);
          if (editVersions.current.get(deviceId) === version) {
            latestPreferences.current = latestPreferences.current.map((item) =>
              item.deviceId === deviceId ? result.preference : item,
            );
            setPreferences(latestPreferences.current);
          }
        });
      saveChains.current.set(deviceId, save);
      try {
        await save;
      } catch (error) {
        if (editVersions.current.get(deviceId) === version) {
          const confirmed = confirmedPreferences.current.get(deviceId);
          if (confirmed) {
            latestPreferences.current = latestPreferences.current.map((item) =>
              item.deviceId === deviceId ? confirmed : item,
            );
            setPreferences(latestPreferences.current);
          }
        }
        throw error;
      } finally {
        if (saveChains.current.get(deviceId) === save) {
          saveChains.current.delete(deviceId);
        }
      }
    });
  }

  if (preferences === null) {
    return <p className="settings-card-inline-message">Loading…</p>;
  }

  const visiblePreferences = preferences.slice(0, visible);
  const remaining = preferences.length - visiblePreferences.length;

  if (preferencesError) {
    return (
      <p role="alert" className="settings-card-inline-message">
        Notification settings could not be loaded.{' '}
        <button type="button" className="secondary" onClick={loadPreferences}>
          Retry
        </button>
      </p>
    );
  }

  return (
    <div className="notification-settings">
      <SettingsRow
        title="Browser notifications"
        description={
          desktopShell
            ? 'The Beacon desktop app can’t receive alerts yet. Turn them on in Chrome, Edge, or the Android app.'
            : 'Receive private Beacon alerts on this browser.'
        }
      >
        <div className="notification-channel-action">
          <span
            className={
              enabled
                ? 'pill pill-on'
                : webPushAvailable
                  ? 'pill'
                  : 'pill pill-warn'
            }
          >
            {enabled ? 'On' : webPushAvailable ? 'Off' : 'Unavailable'}
          </span>
          <button
            className="secondary"
            disabled={channelBusy || !webPushAvailable}
            onClick={() => void (enabled ? disableChannel() : enableChannel())}
          >
            {channelBusy
              ? 'Updating…'
              : enabled
                ? 'Turn off'
                : webPushAvailable
                  ? 'Turn on'
                  : 'Unavailable'}
          </button>
        </div>
      </SettingsRow>
      {channelError && (
        <p role="alert" className="settings-card-inline-message">
          {channelError}
        </p>
      )}

      {preferences.length === 0 ? (
        <div className="notification-empty">
          <p>Pair a camera to choose which alerts it sends.</p>
        </div>
      ) : (
        <>
          <div className="notification-table" role="table">
            <div className="notification-table-head" role="row">
              <span role="columnheader">Camera</span>
              <span role="columnheader">Motion</span>
              <span role="columnheader">Offline &amp; recovery</span>
              <span role="columnheader">Quiet hours</span>
            </div>
            {visiblePreferences.map((preference) => (
              <NotificationCameraRow
                key={preference.deviceId}
                preference={preference}
                onChange={(update) =>
                  updatePreference(preference.deviceId, update)
                }
              />
            ))}
          </div>
          {(remaining > 0 || preferences.length > REVEAL_INITIAL) && (
            <div className="notification-reveal">
              <span>
                {visiblePreferences.length} of {preferences.length} cameras
              </span>
              {remaining > 0 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setVisible((count) =>
                      Math.min(preferences.length, count + REVEAL_STEP),
                    )
                  }
                >
                  Load {Math.min(REVEAL_STEP, remaining)} more
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NotificationCameraRow({
  preference,
  onChange,
}: {
  preference: Preference;
  onChange: (update: (preference: Preference) => Preference) => void;
}) {
  const quietHours = preference.quietHours;
  return (
    <div className="notification-table-row" role="row">
      <span className="notification-table-name" role="cell">
        {preference.deviceName}
      </span>
      <span className="notification-table-cell" role="cell">
        <span className="notification-table-label">Motion</span>
        <Switch
          label={`Motion alerts for ${preference.deviceName}`}
          checked={preference.motionEnabled}
          onChange={(checked) =>
            onChange((item) => ({ ...item, motionEnabled: checked }))
          }
        />
      </span>
      <span className="notification-table-cell" role="cell">
        <span className="notification-table-label">Offline &amp; recovery</span>
        <Switch
          label={`Offline and recovery alerts for ${preference.deviceName}`}
          checked={preference.offlineEnabled}
          onChange={(checked) =>
            onChange((item) => ({ ...item, offlineEnabled: checked }))
          }
        />
      </span>
      <span
        className="notification-table-cell notification-table-quiet"
        role="cell"
      >
        <span className="notification-table-label notification-quiet-heading">
          <span>Quiet hours</span>
          <small>Pause alerts during this window</small>
        </span>
        <Switch
          label={`Quiet hours for ${preference.deviceName}`}
          checked={quietHours !== null}
          onChange={(checked) =>
            onChange((item) => ({
              ...item,
              quietHours: checked
                ? {
                    start: '22:00',
                    end: '07:00',
                    timeZone:
                      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                  }
                : null,
            }))
          }
        />
        {quietHours && (
          <span className="notification-quiet-hours">
            <label className="notification-time-field">
              <span className="notification-time-caption" aria-hidden="true">
                From
              </span>
              <input
                aria-label={`Quiet hours start for ${preference.deviceName}`}
                type="time"
                value={quietHours.start}
                onChange={(event) =>
                  event.target.value &&
                  onChange((item) =>
                    item.quietHours
                      ? {
                          ...item,
                          quietHours: {
                            ...item.quietHours,
                            start: event.target.value,
                          },
                        }
                      : item,
                  )
                }
              />
            </label>
            <span aria-hidden="true">–</span>
            <label className="notification-time-field">
              <span className="notification-time-caption" aria-hidden="true">
                Until
              </span>
              <input
                aria-label={`Quiet hours end for ${preference.deviceName}`}
                type="time"
                value={quietHours.end}
                onChange={(event) =>
                  event.target.value &&
                  onChange((item) =>
                    item.quietHours
                      ? {
                          ...item,
                          quietHours: {
                            ...item.quietHours,
                            end: event.target.value,
                          },
                        }
                      : item,
                  )
                }
              />
            </label>
            <span className="notification-quiet-zone">
              Time zone: {quietHours.timeZone.replace(/_/g, ' ')}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}
