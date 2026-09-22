import { useEffect, useRef, useState } from 'react';

import { request } from './api';
import { BrowserProducer } from './BrowserProducer';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import './BrowserCameraModeSetup.css';
import { browserOsLabel, friendlyDeviceLabel } from './naming';
import { formatClipTimer } from './recording-capture';
import { useClipRecorder } from './useClipRecorder';

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
const CAMERA_NAME_KEY = 'beacon_browser_camera_name';

function initialDeviceName(): string {
  try {
    const saved = localStorage.getItem(CAMERA_NAME_KEY)?.trim();
    if (saved) return saved;
  } catch {
    // Private browsing or a storage policy can make localStorage unavailable.
  }
  return browserOsLabel(navigator.userAgent, 'Beacon browser camera');
}

function rememberDeviceName(name: string): void {
  try {
    localStorage.setItem(CAMERA_NAME_KEY, name);
  } catch {
    // A descriptive default still works when storage is unavailable.
  }
}

/** The four states a viewer of the broadcast stage's own status line needs
 * to tell apart at a glance, per the concise-state list this screen is
 * built around: ready, actively watched, reconnecting, or stopped. */
function broadcastStatusLabel(state: string, viewerCount: number): string {
  if (state === 'streaming') {
    return viewerCount === 1 ? '1 watching' : `${viewerCount} watching`;
  }
  if (state === 'reconnecting') return 'Reconnecting…';
  if (state === 'error') return 'Offline';
  return 'Camera Mode ready';
}

function installationId(): string {
  const existing = localStorage.getItem(INSTALLATION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(INSTALLATION_KEY, created);
  return created;
}

export function BrowserCameraMode({
  onBack,
  canRecord = false,
}: {
  onBack: () => void;
  /** Only the household owner can request recordings (see POST
   * /api/recordings) -- matches the same live-viewer gate in LiveVideo. */
  canRecord?: boolean;
}) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const producerRef = useRef<BrowserProducer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<{ release(): Promise<void> } | null>(null);
  const [inputs, setInputs] = useState<VideoInput[]>([]);
  const [sourceNames, setSourceNames] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState('');
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [state, setState] = useState('offline');
  const [viewerCount, setViewerCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [error, setError] = useState('');
  const [backgrounded, setBackgrounded] = useState(document.hidden);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const clip = useClipRecorder(activeCameraId ?? '');

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
    const normalizedDeviceName = deviceName.trim();
    if (!normalizedDeviceName) {
      setError('Enter a name for this browser camera.');
      return;
    }
    setError('');
    try {
      const result = await request<{ cameras: RegisteredSource[] }>(
        '/api/browser-devices',
        {
          body: JSON.stringify({
            installationId: installationId(),
            name: normalizedDeviceName,
            sources: inputs.map((input) => ({
              facing: 'external',
              name: sourceNames[input.deviceId] || input.label,
              sourceKey: `browser:${input.deviceId}`,
            })),
          }),
          method: 'POST',
        },
      );
      setDeviceName(normalizedDeviceName);
      rememberDeviceName(normalizedDeviceName);
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
      setActiveCameraId(camera.id);
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
    setActiveCameraId(null);
    if (previewRef.current) previewRef.current.srcObject = null;
    setState('offline');
    setViewerCount(0);
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }

  function startRecording() {
    if (!streamRef.current) return;
    setError('');
    clip.start(streamRef.current);
  }

  // Clears a finished clip's status back to the plain record control a few
  // seconds after it lands, matching the live viewer's own record button.
  useEffect(() => {
    if (clip.state.status !== 'available' && clip.state.status !== 'failed')
      return;
    const timer = window.setTimeout(() => clip.reset(), 6_000);
    return () => window.clearTimeout(timer);
  }, [clip, clip.state.status]);

  useEffect(() => {
    if (clip.state.error) setError(clip.state.error);
  }, [clip.state.error]);

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
            className={`broadcast-live${state === 'streaming' ? ' is-watched' : ''}`}
            role="status"
          >
            <span aria-hidden="true" className="broadcast-live-dot" />
            {broadcastStatusLabel(state, viewerCount)}
          </span>
          <div className="broadcast-top-actions">
            {canRecord && clip.supported && activeCameraId && (
              <button
                aria-pressed={clip.state.status === 'recording'}
                className={`broadcast-icon-button${
                  clip.state.status === 'recording' ? ' is-active' : ''
                }`}
                data-tooltip={
                  clip.state.status === 'recording'
                    ? `Recording… ${formatClipTimer(clip.state.elapsedMs)} · tap to stop`
                    : clip.state.status === 'failed'
                      ? 'Recording failed · try again'
                      : 'Record a short clip'
                }
                disabled={
                  clip.state.status === 'starting' ||
                  clip.state.status === 'uploading' ||
                  clip.state.status === 'available'
                }
                onClick={
                  clip.state.status === 'recording' ? clip.stop : startRecording
                }
                type="button"
              >
                <Icon name="record" />
                <span className="visually-hidden">
                  {clip.state.status === 'starting'
                    ? 'Starting recording…'
                    : clip.state.status === 'recording'
                      ? `Recording, ${formatClipTimer(clip.state.elapsedMs)} elapsed. Tap to stop.`
                      : clip.state.status === 'uploading'
                        ? 'Uploading recording'
                        : clip.state.status === 'available'
                          ? 'Recording saved'
                          : clip.state.status === 'failed'
                            ? 'Recording failed, try again'
                            : 'Record a short clip'}
                </span>
              </button>
            )}
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
            {/* settings fields omitted for brevity if needed later */}
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
    <ModalDialog labelledBy="localTitle" onDismiss={onBack}>
      <section className="local-modal" role="dialog" aria-modal="true">
        <div className="local-mh">
          <div>
            <div className="local-eyebrow">Use this device</div>
            <h2 id="localTitle">
              {inputs.length > 0
                ? 'Choose a camera'
                : 'Use this device as a camera'}
            </h2>
            <p id="localSub">
              {inputs.length > 0
                ? 'Select the camera Beacon should use on this device.'
                : 'Temporary monitoring. Keep Beacon open while the camera is active.'}
            </p>
          </div>
        </div>

        <div className="local-steps">
          <span className="local-step on"></span>
          <span
            className={`local-step ${inputs.length > 0 ? 'on' : ''}`}
          ></span>
        </div>

        {error && (
          <p role="alert" style={{ color: 'var(--status-error)' }}>
            {error}
          </p>
        )}

        {inputs.length === 0 ? (
          <div id="permission">
            <div className="local-permission">
              <div className="local-permission-icon">
                <Icon name="camera" />
              </div>
              <div>
                <b>Camera access is required</b>
                <p>
                  Beacon needs permission to find cameras connected to this
                  device. Your browser or operating system may show a permission
                  prompt.
                </p>
              </div>
            </div>
            <div className="local-actions">
              <button className="btn secondary" onClick={onBack}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void discover()}>
                Allow camera access
              </button>
            </div>
          </div>
        ) : (
          <div id="configure">
            <div className="local-controls">
              <div className="local-field">
                <label htmlFor="deviceName">Device name</label>
                <input
                  id="deviceName"
                  value={deviceName}
                  maxLength={100}
                  onChange={(event) => setDeviceName(event.target.value)}
                />
                <div className="local-hint">
                  How this device appears in Beacon.
                </div>
              </div>
              <div className="local-field">
                <label htmlFor="cameraSelect">Camera</label>
                <select
                  id="cameraSelect"
                  value={selectedKey}
                  onChange={(event) => setSelectedKey(event.target.value)}
                >
                  {inputs.map((input) => (
                    <option key={input.deviceId} value={input.deviceId}>
                      {input.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="local-field full">
                <label htmlFor="cameraName">Camera name</label>
                <input
                  id="cameraName"
                  value={sourceNames[selectedKey] ?? ''}
                  maxLength={100}
                  onChange={(event) =>
                    setSourceNames((current) => ({
                      ...current,
                      [selectedKey]: event.target.value,
                    }))
                  }
                />
                <div className="local-hint">You can rename it later.</div>
              </div>
              <label className="local-check full">
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
                <span>Keep this device awake while Camera Mode is active</span>
              </label>
            </div>
            <div className="local-actions">
              <button className="btn secondary" onClick={onBack}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => void registerAndStart()}
              >
                Start camera
              </button>
            </div>
          </div>
        )}
      </section>
    </ModalDialog>
  );
}
