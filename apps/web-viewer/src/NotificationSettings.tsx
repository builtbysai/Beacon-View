import { useEffect, useState } from 'react';
import { request } from './api';
import { Icon } from './Icon';

interface Preference {
  deviceId: string;
  deviceName: string;
  motionEnabled: boolean;
  offlineEnabled: boolean;
  quietHours: { start: string; end: string; timeZone: string } | null;
}

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
  const created = crypto.randomUUID();
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

export function NotificationSettings() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [savedPreferences, setSavedPreferences] = useState<Preference[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [channelBusy, setChannelBusy] = useState(false);
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void request<{ preferences: Preference[] }>('/api/notification-preferences')
      .then((result) => {
        setPreferences(result.preferences);
        setSavedPreferences(result.preferences);
      })
      .catch(() =>
        setMessage('Notification preferences are temporarily unavailable.'),
      );
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

  async function enable() {
    setChannelBusy(true);
    setMessage('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        throw new Error('This browser does not support notifications.');
      if ((await Notification.requestPermission()) !== 'granted')
        throw new Error(
          'Notifications were not allowed. You can change this in browser settings.',
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
      setMessage('Notifications are on. Lock-screen details stay private.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Notifications could not be enabled.',
      );
    } finally {
      setChannelBusy(false);
    }
  }

  async function disable() {
    setChannelBusy(true);
    setMessage('');
    try {
      await disableWebNotifications();
      setEnabled(false);
      setMessage('Notifications are off on this browser.');
    } finally {
      setChannelBusy(false);
    }
  }

  async function save(preference: Preference) {
    setSavingDeviceId(preference.deviceId);
    setMessage('');
    try {
      const result = await request<{ preference: Preference }>(
        `/api/notification-preferences/${encodeURIComponent(preference.deviceId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            motionEnabled: preference.motionEnabled,
            offlineEnabled: preference.offlineEnabled,
            quietHours: preference.quietHours,
          }),
        },
      );
      setPreferences((items) =>
        items.map((item) =>
          item.deviceId === result.preference.deviceId
            ? result.preference
            : item,
        ),
      );
      setSavedPreferences((items) =>
        items.map((item) =>
          item.deviceId === result.preference.deviceId
            ? result.preference
            : item,
        ),
      );
      setMessage(`${preference.deviceName} notification preferences saved.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Preferences could not be saved.',
      );
    } finally {
      setSavingDeviceId(null);
    }
  }

  function updatePreference(
    deviceId: string,
    update: (preference: Preference) => Preference,
  ) {
    setPreferences((items) =>
      items.map((item) => (item.deviceId === deviceId ? update(item) : item)),
    );
    setMessage('');
  }

  function isDirty(preference: Preference): boolean {
    const saved = savedPreferences.find(
      (item) => item.deviceId === preference.deviceId,
    );
    return saved ? JSON.stringify(saved) !== JSON.stringify(preference) : true;
  }

  return (
    <div className="notification-settings">
      <div className="notification-channel-card" data-enabled={enabled}>
        <span className="notification-channel-icon">
          <Icon name="alert" />
        </span>
        <div className="notification-channel-copy">
          <span className="notification-eyebrow">Browser delivery</span>
          <div className="notification-channel-title">
            <strong>Notifications on this browser</strong>
            <span className="notification-state">{enabled ? 'On' : 'Off'}</span>
          </div>
          <p>
            Receive private alerts here even when Beacon is not the active tab.
            Camera names, images, and audio are never included.
          </p>
        </div>
        <button
          className={enabled ? 'secondary' : ''}
          disabled={channelBusy}
          onClick={() => void (enabled ? disable() : enable())}
        >
          {channelBusy ? 'Updating…' : enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      <div className="notification-preference-heading">
        <div>
          <h4>Alert preferences</h4>
          <p>Choose what each camera sends to your opted-in viewers.</p>
        </div>
        <span>{preferences.length} cameras</span>
      </div>
      <div className="notification-camera-grid">
        {preferences.map((preference) => {
          const dirty = isDirty(preference);
          const saving = savingDeviceId === preference.deviceId;
          const alertCount = [
            preference.motionEnabled,
            preference.offlineEnabled,
          ].filter(Boolean).length;
          return (
            <article
              className="notification-camera-card"
              key={preference.deviceId}
            >
              <header>
                <span className="notification-camera-icon">
                  <Icon name="camera" />
                </span>
                <div>
                  <strong>{preference.deviceName}</strong>
                  <span>
                    {alertCount === 0
                      ? 'No alerts enabled'
                      : `${alertCount} alert${alertCount === 1 ? '' : 's'} enabled`}
                  </span>
                </div>
              </header>
              <label className="notification-toggle-row">
                <span>
                  <strong>Motion alerts</strong>
                  <small>When Beacon accepts a new motion event</small>
                </span>
                <input
                  type="checkbox"
                  aria-label="Motion alerts"
                  checked={preference.motionEnabled}
                  onChange={(event) =>
                    updatePreference(preference.deviceId, (item) => ({
                      ...item,
                      motionEnabled: event.target.checked,
                    }))
                  }
                />
              </label>
              <label className="notification-toggle-row">
                <span>
                  <strong>Offline &amp; recovery</strong>
                  <small>
                    After the connection grace period, and when it returns
                  </small>
                </span>
                <input
                  type="checkbox"
                  aria-label="Offline and recovery alerts"
                  checked={preference.offlineEnabled}
                  onChange={(event) =>
                    updatePreference(preference.deviceId, (item) => ({
                      ...item,
                      offlineEnabled: event.target.checked,
                    }))
                  }
                />
              </label>
              <div className="notification-quiet-block">
                <label className="notification-toggle-row">
                  <span>
                    <strong>Quiet hours</strong>
                    <small>Pause push alerts on a daily schedule</small>
                  </span>
                  <input
                    type="checkbox"
                    aria-label="Quiet hours"
                    checked={preference.quietHours !== null}
                    onChange={(event) =>
                      updatePreference(preference.deviceId, (item) => ({
                        ...item,
                        quietHours: event.target.checked
                          ? {
                              start: '22:00',
                              end: '07:00',
                              timeZone:
                                Intl.DateTimeFormat().resolvedOptions()
                                  .timeZone || 'UTC',
                            }
                          : null,
                      }))
                    }
                  />
                </label>
                {preference.quietHours && (
                  <div className="notification-quiet-hours">
                    <label>
                      <span>From</span>
                      <input
                        type="time"
                        value={preference.quietHours.start}
                        onChange={(event) =>
                          updatePreference(preference.deviceId, (item) => ({
                            ...item,
                            quietHours: {
                              ...preference.quietHours!,
                              start: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Until</span>
                      <input
                        type="time"
                        value={preference.quietHours.end}
                        onChange={(event) =>
                          updatePreference(preference.deviceId, (item) => ({
                            ...item,
                            quietHours: {
                              ...preference.quietHours!,
                              end: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                    <small>{preference.quietHours.timeZone}</small>
                  </div>
                )}
              </div>
              <footer>
                <span>{dirty ? 'Unsaved changes' : 'Up to date'}</span>
                <button
                  className="secondary"
                  disabled={!dirty || saving}
                  onClick={() => void save(preference)}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {preferences.length === 0 && (
        <div className="notification-empty">
          <Icon name="camera" />
          <p>Pair a camera to choose which alerts it sends.</p>
        </div>
      )}
      {message && (
        <p className="notification-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
