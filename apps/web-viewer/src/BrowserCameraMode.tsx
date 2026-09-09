import { useEffect, useRef, useState } from 'react';

import { request } from './api';
import { BrowserProducer } from './BrowserProducer';
import { Icon } from './Icon';

interface RegisteredSource {
  id: string;
  name: string;
  sourceKey: string;
}

interface VideoInput {
  deviceId: string;
  label: string;
}

const INSTALLATION_KEY = 'beacon_browser_device_id';

/** Browser-reported camera labels often carry a raw USB vendor:product id,
 * e.g. "HD Pro Webcam C920 (046d:08e5)" — strip that for what's shown/
 * pre-filled in the UI. The user-editable name field still lets someone
 * override it, and nothing here is fabricated: it's the same label the
 * browser already gave us, just without the debugging suffix. */
function friendlyDeviceLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

function installationId(): string {
  const existing = localStorage.getItem(INSTALLATION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

export function BrowserCameraMode({ onBack }: { onBack: () => void }) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const producerRef = useRef<BrowserProducer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const [inputs, setInputs] = useState<VideoInput[]>([]);
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
  const [registered, setRegistered] = useState<RegisteredSource[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [deviceName, setDeviceName] = useState('This browser');
  const [state, setState] = useState('offline');
  const [viewerCount, setViewerCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState('');
  const [backgrounded, setBackgrounded] = useState(document.hidden);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The preview <video> element lives in different branches of the returned
  // JSX (setup card vs. full-bleed broadcast stage) and gets remounted when
  // `state` flips away from 'offline', which drops whatever srcObject was
  // assigned directly in registerAndStart. Re-sync after every render so the
  // newly-mounted node always reflects the current stream.
  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = streamRef.current;
  });

  useEffect(() => {
    const visibility = () => setBackgrounded(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      producerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void wakeLockRef.current?.release();
    };
  }, []);

  useEffect(() => {
    if (!backgrounded && wakeLockEnabled && streamRef.current) {
      void acquireWakeLock();
    }
  }, [backgrounded, wakeLockEnabled]);

  async function discover() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices) {
      setError('Browser Camera Mode requires a trusted HTTPS connection.');
      return;
    }
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label
            ? friendlyDeviceLabel(device.label)
            : `Camera ${index + 1}`,
        }));
      setInputs(devices);
      setSourceNames(
        Object.fromEntries(
          devices.map((device) => [device.deviceId, device.label]),
        ),
      );
      setSelectedKey((current) => current || devices[0]?.deviceId || '');
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow access to use Camera Mode.'
          : 'No usable camera was found.',
      );
    }
  }

  async function registerAndStart(requestedKey = selectedKey) {
    const selected = inputs.find((input) => input.deviceId === requestedKey);
    if (!selected) return;
    setError('');
    try {
      const result = await request<{ cameras: RegisteredSource[] }>(
        '/api/browser-devices',
        {
          body: JSON.stringify({
            installationId: installationId(),
            name: deviceName,
            sources: inputs.map((input) => ({
              facing: 'external',
              name: sourceNames[input.deviceId] || input.label,
              sourceKey: `browser:${input.deviceId}`,
            })),
          }),
          method: 'POST',
        },
      );
      setRegistered(result.cameras);
      const camera = result.cameras.find(
        (source) => source.sourceKey === `browser:${selected.deviceId}`,
      );
      if (!camera) throw new Error('Camera registration was incomplete');
      producerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: selected.deviceId },
          frameRate: { ideal: 24, max: 30 },
          height: { ideal: 720, max: 1080 },
          width: { ideal: 1280, max: 1920 },
        },
      });
      for (const track of stream.getVideoTracks()) track.contentHint = 'motion';
      streamRef.current = stream;
      if (previewRef.current) previewRef.current.srcObject = stream;
      producerRef.current = new BrowserProducer(
        camera.id,
        stream,
        (next, viewers, retries) => {
          setState(next);
          setViewerCount(viewers);
          setRetryCount(retries);
        },
        (cameraId) => {
          const source = result.cameras.find((item) => item.id === cameraId);
          const nextKey = source?.sourceKey.replace(/^browser:/, '');
          if (!nextKey || nextKey === selected.deviceId) return;
          setSelectedKey(nextKey);
          void registerAndStart(nextKey);
        },
      );
      producerRef.current.start();
      if (wakeLockEnabled) await acquireWakeLock();
    } catch (caught) {
      setState('error');
      setError(
        caught instanceof Error ? caught.message : 'Unable to start camera',
      );
    }
  }

  function stop() {
    producerRef.current?.stop();
    producerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setState('offline');
    setViewerCount(0);
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }

  async function acquireWakeLock() {
    const manager = (
      navigator as Navigator & {
        wakeLock?: {
          request(type: 'screen'): Promise<{ release(): Promise<void> }>;
        };
      }
    ).wakeLock;
    if (!manager || document.hidden) return;
    wakeLockRef.current = await manager.request('screen');
  }

  const fields = (
    <>
      <label>
        Device name
        <input
          value={deviceName}
          maxLength={100}
          onChange={(event) => setDeviceName(event.target.value)}
        />
      </label>
      <label>
        Camera
        <select
          value={selectedKey}
          onChange={(event) => setSelectedKey(event.target.value)}
        >
          {inputs.map((input) => (
            <option key={input.deviceId} value={input.deviceId}>
              {input.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Selected camera name
        <input
          value={sourceNames[selectedKey] ?? ''}
          maxLength={100}
          onChange={(event) =>
            setSourceNames((current) => ({
              ...current,
              [selectedKey]: event.target.value,
            }))
          }
        />
      </label>
      <label className="checkbox-label">
        <input
          checked={wakeLockEnabled}
          type="checkbox"
          onChange={(event) => {
            const enabled = event.target.checked;
            setWakeLockEnabled(enabled);
            if (!enabled) {
              void wakeLockRef.current?.release();
              wakeLockRef.current = null;
            } else if (state !== 'offline') {
              void acquireWakeLock();
            }
          }}
        />
        Keep this screen awake while Camera Mode is active
      </label>
      {registered.length > 1 && (
        <p className="notice">
          {registered.length} cameras are set up on this browser. Only the
          selected one is active.
        </p>
      )}
    </>
  );

  if (state !== 'offline') {
    return (
      <main className="broadcast-stage">
        <video
          ref={previewRef}
          autoPlay
          className="broadcast-video"
          playsInline
          muted
        />
        <div className="broadcast-top">
          <span
            className={`broadcast-live${viewerCount > 0 ? ' is-watched' : ''}`}
            role="status"
          >
            <span aria-hidden="true" className="broadcast-live-dot" />
            {viewerCount > 0
              ? viewerCount === 1
                ? '1 viewer watching now'
                : `${viewerCount} viewers watching now`
              : 'Camera Mode active · ready for viewing'}
          </span>
          <div className="broadcast-top-actions">
            <button
              aria-expanded={settingsOpen}
              aria-label="Camera settings"
              className="broadcast-icon-button"
              onClick={() => setSettingsOpen((open) => !open)}
              type="button"
            >
              <Icon name={settingsOpen ? 'close' : 'settings'} />
            </button>
          </div>
        </div>
        {backgrounded && (
          <p className="broadcast-warning" role="status">
            This tab is backgrounded. Capture or networking may be throttled.
          </p>
        )}
        {error && (
          <p className="broadcast-warning" role="alert">
            {error}
          </p>
        )}
        <p className="visually-hidden" role="status">
          Camera: {state} · Viewers: {viewerCount} · Reconnects: {retryCount}
        </p>
        {settingsOpen && (
          <div
            className="broadcast-settings"
            role="dialog"
            aria-label="Camera settings"
          >
            {fields}
            <div className="heading-actions">
              <button onClick={() => void registerAndStart()}>
                Switch camera
              </button>
              <button className="secondary" onClick={onBack} type="button">
                Back to dashboard
              </button>
            </div>
          </div>
        )}
        <button className="broadcast-stop" onClick={stop} type="button">
          Stop Camera Mode
        </button>
      </main>
    );
  }

  return (
    <main className="shell camera-mode-shell">
      <section className="card wide" aria-labelledby="camera-mode-title">
        <div className="heading">
          <div>
            <p className="eyebrow">Producer</p>
            <h1 id="camera-mode-title">Browser Camera Mode</h1>
          </div>
          <button className="secondary" onClick={onBack}>
            Back to dashboard
          </button>
        </div>
        <p>
          Use an attended browser and webcam as a Beacon camera. Browsers may
          throttle background tabs and cannot match Android foreground-service
          reliability.
        </p>
        {backgrounded && (
          <p className="warning" role="status">
            This tab is backgrounded. Capture or networking may be throttled.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {inputs.length === 0 ? (
          <button onClick={() => void discover()}>
            Allow and find cameras
          </button>
        ) : (
          <div className="camera-mode-controls">
            {fields}
            <button onClick={() => void registerAndStart()}>
              Start camera
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
