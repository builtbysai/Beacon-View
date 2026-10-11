import { useEffect, useId, useRef, useState } from 'react';
import { request } from './api';

interface MotionSettings {
  cameraId: string;
  enabled: boolean;
  recordOnMotion: boolean;
  sensitivity: 'low' | 'medium' | 'high';
  cooldownSeconds: 30 | 60 | 120 | 300;
  quietHours: { start: string; end: string; timeZone: string } | null;
}

export function MotionSettingsPanel({
  deviceId,
  cameras,
  driveState,
}: {
  deviceId: string;
  cameras: { id: string; name: string }[];
  /** Whether clips can be saved right now; when they cannot, record on
   * motion looks set up but produces nothing, so say so (V63). */
  driveState?:
    'checking' | 'ready' | 'not_connected' | 'expired' | 'unavailable';
}) {
  const [settings, setSettings] = useState<MotionSettings[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  const generation = useRef(0);
  const helpId = useId();

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setSettings(null);
    setError('');
    setNotice('');
    setBusy(false);
    pending.current = false;
    void request<{ cameras: MotionSettings[] }>(
      `/api/devices/${encodeURIComponent(deviceId)}/motion-settings`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (generation.current !== current) return;
        setSettings(result.cameras);
        setSelected(result.cameras[0]?.cameraId ?? '');
      })
      .catch(() => {
        if (generation.current === current)
          setError('Motion settings could not be loaded. Try again.');
      });
    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [deviceId, reload]);

  const active = settings?.find((item) => item.cameraId === selected);

  function change(patch: Partial<MotionSettings>) {
    setSettings(
      (items) =>
        items?.map((item) =>
          item.cameraId === selected ? { ...item, ...patch } : item,
        ) ?? null,
    );
    setNotice('');
  }

  async function save() {
    if (!active || pending.current) return;
    pending.current = true;
    const current = generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    const { cameraId, ...body } = active;
    try {
      const result = await request<{ settings: MotionSettings }>(
        `/api/cameras/${encodeURIComponent(cameraId)}/motion-settings`,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      if (generation.current !== current) return;
      setSettings(
        (items) =>
          items?.map((item) =>
            item.cameraId === cameraId ? result.settings : item,
          ) ?? null,
      );
      setNotice(
        'Saved. Your phone applies the settings on its next connection check.',
      );
    } catch {
      if (generation.current === current)
        setError(
          'Changes could not be saved. Your edits are still here to retry.',
        );
    } finally {
      if (generation.current === current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <section
      className="camera-settings-group camera-motion-settings"
      aria-labelledby={`${helpId}-title`}
    >
      <div className="camera-settings-group-head">
        <div>
          <h3 id={`${helpId}-title`}>Motion</h3>
          <p id={helpId}>
            Detection controls for this camera. Motion creates activity metadata
            only.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="camera-settings-form-message is-error">
          {error}
        </p>
      )}
      {!settings && !error && (
        <p role="status" className="camera-settings-form-message">
          Loading motion settings…
        </p>
      )}
      {!settings && error && (
        <button
          type="button"
          className="secondary"
          onClick={() => setReload((value) => value + 1)}
        >
          Retry motion settings
        </button>
      )}
      {settings?.length === 0 && (
        <p className="camera-settings-form-message">
          Motion settings are unavailable for this device.
        </p>
      )}

      {active && (
        <form
          className="camera-motion-form"
          aria-label="Camera motion settings"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {settings && settings.length > 1 && (
            <label className="camera-settings-form-row">
              <span>
                <strong>Camera</strong>
                <small>Choose the source to configure.</small>
              </span>
              <select
                aria-label="Motion settings camera"
                disabled={busy}
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setNotice('');
                  setError('');
                }}
              >
                {settings.map((item) => (
                  <option key={item.cameraId} value={item.cameraId}>
                    {cameras.find((camera) => camera.id === item.cameraId)
                      ?.name ?? 'Camera'}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="camera-settings-form-row">
            <span>
              <strong>Motion detection</strong>
              <small>Create motion events when activity is detected.</small>
            </span>
            <label className="camera-settings-switch-label">
              <input
                aria-label="Detect motion on this camera"
                className="visually-hidden"
                type="checkbox"
                checked={active.enabled}
                disabled={busy}
                onChange={(event) => change({ enabled: event.target.checked })}
                aria-describedby={helpId}
              />
              <span
                className={`camera-settings-switch ${active.enabled ? 'is-on' : ''}`}
              >
                <span />
              </span>
            </label>
          </div>

          <label className="camera-settings-form-row">
            <span>
              <strong>Sensitivity</strong>
              <small>How readily motion creates an event.</small>
            </span>
            <select
              aria-label="Sensitivity"
              disabled={busy || !active.enabled}
              value={active.sensitivity}
              onChange={(event) =>
                change({
                  sensitivity: event.target
                    .value as MotionSettings['sensitivity'],
                })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <div className="camera-settings-form-row">
            <span>
              <strong>Record on motion</strong>
              <small>Save a short clip when motion is detected.</small>
              {active.recordOnMotion &&
                (driveState === 'not_connected' ||
                  driveState === 'expired' ||
                  driveState === 'unavailable') && (
                  <small role="alert">
                    {driveState === 'unavailable'
                      ? 'Clips are not available on this Beacon server, so none will be saved.'
                      : driveState === 'expired'
                        ? 'Google Drive needs to be reconnected, or no clips will be saved.'
                        : 'Google Drive is not connected, so no clips will be saved.'}{' '}
                    <a href="/settings?section=storage">
                      Open Google Drive settings
                    </a>
                  </small>
                )}
            </span>
            <label className="camera-settings-switch-label">
              <input
                aria-label="Record a short clip when motion is detected"
                className="visually-hidden"
                type="checkbox"
                checked={active.recordOnMotion}
                disabled={busy || !active.enabled}
                onChange={(event) =>
                  change({ recordOnMotion: event.target.checked })
                }
              />
              <span
                className={`camera-settings-switch ${active.recordOnMotion ? 'is-on' : ''}`}
              >
                <span />
              </span>
            </label>
          </div>

          <label className="camera-settings-form-row">
            <span>
              <strong>Time between events</strong>
              <small>Minimum delay before another event can be created.</small>
            </span>
            <select
              aria-label="Time between events"
              disabled={busy || !active.enabled}
              value={active.cooldownSeconds}
              onChange={(event) =>
                change({
                  cooldownSeconds: Number(
                    event.target.value,
                  ) as MotionSettings['cooldownSeconds'],
                })
              }
            >
              <option value={30}>30 seconds</option>
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
            </select>
          </label>

          <fieldset
            className="camera-settings-quiet-hours"
            disabled={busy || !active.enabled}
          >
            <div className="camera-settings-form-row">
              <span>
                <strong>Quiet hours</strong>
                <small>Pause motion events on a daily schedule.</small>
              </span>
              <label className="camera-settings-switch-label">
                <input
                  aria-label="Quiet hours"
                  className="visually-hidden"
                  type="checkbox"
                  checked={active.quietHours !== null}
                  onChange={(event) =>
                    change({
                      quietHours: event.target.checked
                        ? {
                            start: '22:00',
                            end: '07:00',
                            timeZone:
                              Intl.DateTimeFormat().resolvedOptions().timeZone,
                          }
                        : null,
                    })
                  }
                />
                <span
                  className={`camera-settings-switch ${active.quietHours ? 'is-on' : ''}`}
                >
                  <span />
                </span>
              </label>
            </div>
            {active.quietHours && (
              <div className="camera-settings-time-grid">
                <label>
                  Start
                  <input
                    aria-label="Quiet hours start"
                    type="time"
                    required
                    value={active.quietHours.start}
                    onChange={(event) =>
                      change({
                        quietHours: {
                          ...active.quietHours!,
                          start: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    aria-label="Quiet hours end"
                    type="time"
                    required
                    value={active.quietHours.end}
                    onChange={(event) =>
                      change({
                        quietHours: {
                          ...active.quietHours!,
                          end: event.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Time zone
                  <input
                    aria-label="Quiet hours time zone"
                    required
                    value={active.quietHours.timeZone}
                    onChange={(event) =>
                      change({
                        quietHours: {
                          ...active.quietHours!,
                          timeZone: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            )}
          </fieldset>

          <div className="camera-motion-save-row">
            <p role="status">{notice}</p>
            <button type="submit" className="secondary" disabled={busy}>
              {busy ? 'Saving…' : 'Save motion settings'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
