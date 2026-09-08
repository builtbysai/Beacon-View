import { useEffect, useRef, useState } from 'react';

import { request } from './api';
import { BrowserProducer } from './BrowserProducer';

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
          label: device.label || `Camera ${index + 1}`,
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
            <label>
              Device name
              <input
                value={deviceName}
                maxLength={100}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </label>
            <label>
              Camera source
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
            <label>
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
            <button onClick={() => void registerAndStart()}>
              {state === 'offline' ? 'Start camera' : 'Switch camera'}
            </button>
            {state !== 'offline' && (
              <button className="secondary" onClick={stop}>
                Stop camera
              </button>
            )}
          </div>
        )}
        <div className="video-frame" hidden={inputs.length === 0}>
          <video ref={previewRef} autoPlay playsInline muted />
        </div>
        <p role="status">
          Camera: {state} · Viewers: {viewerCount} · Reconnects: {retryCount}
        </p>
        {registered.length > 1 && (
          <p className="notice">
            {registered.length} webcam sources are registered under this browser
            device. Only the selected source is active.
          </p>
        )}
      </section>
    </main>
  );
}
