import { useEffect, useId, useRef, useState } from 'react';
import { request } from './api';

interface MotionSettings {
  cameraId: string;
  enabled: boolean;
  sensitivity: 'low' | 'medium' | 'high';
  cooldownSeconds: 30 | 60 | 120 | 300;
  quietHours: { start: string; end: string; timeZone: string } | null;
}

export function MotionSettingsPanel({
  deviceId,
  cameras,
}: {
  deviceId: string;
  cameras: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
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
    if (!open) return;
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
  }, [open, deviceId, reload]);

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
    <details
      className="device-settings"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Motion settings</summary>
      {open && (
        <div className="device-settings-content">
          <p id={helpId}>
            Choose how this phone detects changes. Motion creates activity
            metadata only. Use privacy mode to stop camera and microphone
            capture.
          </p>
          {error && <p role="alert">{error}</p>}
          {!settings && !error && <p role="status">Loading motion settings…</p>}
          {!settings && error && (
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              Retry motion settings
            </button>
          )}
          {settings?.length === 0 && (
            <p>Motion settings are unavailable for this device.</p>
          )}
          {active && (
            <form
              aria-label="Camera motion settings"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <label>
                Camera
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
                  {settings?.map((item) => (
                    <option key={item.cameraId} value={item.cameraId}>
                      {cameras.find((camera) => camera.id === item.cameraId)
                        ?.name ?? 'Camera'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="motion-enabled">
                <input
                  type="checkbox"
                  checked={active.enabled}
                  disabled={busy}
                  onChange={(event) =>
                    change({ enabled: event.target.checked })
                  }
                  aria-describedby={helpId}
                />
                Detect motion on this camera
              </label>
              <label>
                Sensitivity
                <select
                  disabled={busy || !active.enabled}
                  value={active.sensitivity}
                  onChange={(event) =>
                    change({
                      sensitivity: event.target
                        .value as MotionSettings['sensitivity'],
                    })
                  }
                >
                  <option value="low">Low · larger changes</option>
                  <option value="medium">Medium · balanced</option>
                  <option value="high">High · smaller changes</option>
                </select>
              </label>
              <p className="notice">
                Higher sensitivity may also detect lighting changes and shadows.
                It does not identify people or objects.
              </p>
              <label>
                Time between events
                <select
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
              <fieldset disabled={busy || !active.enabled}>
                <legend>Daily quiet hours</legend>
                <label className="motion-enabled">
                  <input
                    type="checkbox"
                    checked={active.quietHours !== null}
                    onChange={(event) =>
                      change({
                        quietHours: event.target.checked
                          ? {
                              start: '22:00',
                              end: '07:00',
                              timeZone:
                                Intl.DateTimeFormat().resolvedOptions()
                                  .timeZone,
                            }
                          : null,
                      })
                    }
                  />
                  Pause motion events every day
                </label>
                {active.quietHours && (
                  <>
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
                    <p className="notice">
                      Uses this IANA time zone daily, including daylight-saving
                      changes. Live viewing stays available.
                    </p>
                  </>
                )}
              </fieldset>
              <button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save motion settings'}
              </button>
              <p role="status">{notice}</p>
            </form>
          )}
        </div>
      )}
    </details>
  );
}
