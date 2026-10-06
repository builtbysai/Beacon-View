import { useEffect, useRef, useState } from 'react';

import { ApiError, request } from './api';
import { BrowserProducer } from './BrowserProducer';
import { Brand, Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import { PairingCodeScanner } from './PairingCodeScanner';
import './BrowserCameraModeSetup.css';
import { browserOsLabel, friendlyDeviceLabel } from './naming';
import { formatClipTimer } from './recording-capture';
import { RecordingBadge } from './RecordingBadge';
import { useClipRecorder } from './useClipRecorder';
import { rememberLocalBrowserDevice } from './browser-camera-local';
import { randomUuid } from './random-id';

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
const WAKE_LOCK_KEY = 'beacon_browser_keep_awake';

function initialWakeLockEnabled(): boolean {
  try {
    return localStorage.getItem(WAKE_LOCK_KEY) === 'true';
  } catch {
    return false;
  }
}

function wakeLockSupported(): boolean {
  const manager = (
    navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<unknown> };
    }
  ).wakeLock;
  return typeof manager?.request === 'function';
}

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
  try {
    const existing = localStorage.getItem(INSTALLATION_KEY);
    if (existing) return existing;
    const created = randomUuid();
    localStorage.setItem(INSTALLATION_KEY, created);
    return created;
  } catch {
    throw new Error('Enable browser storage to keep this camera connected.');
  }
}

export function BrowserCameraMode({
  onBack,
  canRecord = false,
  standalone = false,
}: {
  onBack: () => void;
  standalone?: boolean;
  /** Only the household owner can request recordings (see POST
   * /api/recordings) -- matches the same live-viewer gate in LiveVideo. */
  canRecord?: boolean;
}) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const producerRef = useRef<BrowserProducer | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeSourceKey = useRef<string | null>(null);
  const startGeneration = useRef(0);
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
  const [wakeLockEnabled, setWakeLockEnabled] = useState(
    initialWakeLockEnabled,
  );
  const wakeLockEnabledRef = useRef(wakeLockEnabled);
  wakeLockEnabledRef.current = wakeLockEnabled;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState(
    () =>
      new URLSearchParams(window.location.search).get('code')?.toUpperCase() ??
      '',
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const clip = useClipRecorder(activeCameraId ?? '');
  const clipBusy =
    clip.state.status === 'starting' ||
    clip.state.status === 'recording' ||
    clip.state.status === 'uploading';
  const clipBusyRef = useRef(clipBusy);
  clipBusyRef.current = clipBusy;

  // The preview <video> element lives in different branches of the returned
  // JSX (setup card vs. full-bleed broadcast stage) and gets remounted when
  // `state` flips away from 'offline', which drops whatever srcObject was
  // assigned directly in registerAndStart. Re-sync after every render so the
  // newly-mounted node always reflects the current stream.
  useEffect(() => {
    if (standalone && window.location.search.includes('code=')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [standalone]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = streamRef.current;
  });

  useEffect(() => {
    const visibility = () => setBackgrounded(document.hidden);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      startGeneration.current += 1;
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
    setScannerOpen(false);
    if (streamRef.current && clipBusyRef.current) {
      setError('Finish the current recording before switching cameras.');
      return;
    }
    const selected = inputs.find((input) => input.deviceId === requestedKey);
    if (!selected) return;
    const normalizedDeviceName = deviceName.trim();
    if (!normalizedDeviceName) {
      setError('Enter a name for this browser camera.');
      return;
    }
    const generation = ++startGeneration.current;
    setError('');
    try {
      const path = standalone
        ? pairingCode.trim()
          ? '/api/browser-devices/pair'
          : '/api/browser-devices/restore'
        : '/api/browser-devices';
      const result = await request<{
        cameras: RegisteredSource[];
        device?: { id: string; name: string };
      }>(path, {
        body: JSON.stringify({
          installationId: installationId(),
          name: normalizedDeviceName,
          ...(standalone && pairingCode.trim()
            ? { pairingCode: pairingCode.trim() }
            : {}),
          sources: inputs.map((input) => ({
            facing: 'external',
            name: sourceNames[input.deviceId] || input.label,
            sourceKey: `browser:${input.deviceId}`,
          })),
        }),
        method: 'POST',
      });
      if (generation !== startGeneration.current) return;
      const registeredName = result.device?.name ?? normalizedDeviceName;
      if (result.device?.id) rememberLocalBrowserDevice(result.device.id);
      if (standalone) setPairingCode('');
      setDeviceName(registeredName);
      rememberDeviceName(registeredName);
      setSourceNames((current) =>
        Object.fromEntries(
          inputs.map((input) => [
            input.deviceId,
            result.cameras.find(
              (source) => source.sourceKey === `browser:${input.deviceId}`,
            )?.name ??
              current[input.deviceId] ??
              input.label,
          ]),
        ),
      );
      const camera = result.cameras.find(
        (source) => source.sourceKey === `browser:${selected.deviceId}`,
      );
      if (!camera) throw new Error('Camera registration was incomplete');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: selected.deviceId },
          frameRate: { ideal: 24, max: 30 },
          height: { ideal: 720, max: 1080 },
          width: { ideal: 1280, max: 1920 },
        },
      });
      if (generation !== startGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      producerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      for (const track of stream.getVideoTracks()) track.contentHint = 'motion';
      streamRef.current = stream;
      activeSourceKey.current = selected.deviceId;
      setSelectedKey(selected.deviceId);
      setActiveCameraId(camera.id);
      if (previewRef.current) previewRef.current.srcObject = stream;
      producerRef.current = new BrowserProducer(
        camera.id,
        stream,
        (next, viewers, retries) => {
          if (next === 'error') {
            stop();
            setError('Camera access was denied or revoked.');
            return;
          }
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
      if (generation !== startGeneration.current) return;
      if (!streamRef.current) setState('offline');
      else if (activeSourceKey.current) setSelectedKey(activeSourceKey.current);
      setError(
        standalone && caught instanceof ApiError && caught.status === 401
          ? 'Enter a fresh pairing code from a signed-in Beacon account.'
          : caught instanceof Error
            ? caught.message
            : 'Unable to start camera',
      );
    }
  }

  function stop() {
    startGeneration.current += 1;
    producerRef.current?.stop();
    producerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    activeSourceKey.current = null;
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
    if (clip.state.status !== 'available') return;
    const timer = window.setTimeout(() => clip.reset(), 6_000);
    return () => window.clearTimeout(timer);
  }, [clip.reset, clip.state.status]);

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
    const generation = startGeneration.current;
    try {
      const lock = await manager.request('screen');
      if (
        generation !== startGeneration.current ||
        !wakeLockEnabledRef.current ||
        document.hidden
      ) {
        await lock.release();
        return;
      }
      wakeLockRef.current = lock;
    } catch {
      if (generation !== startGeneration.current) return;
      wakeLockEnabledRef.current = false;
      setWakeLockEnabled(false);
      try {
        localStorage.setItem(WAKE_LOCK_KEY, 'false');
      } catch {
        // The setting remains session-only when storage is unavailable.
      }
      setError('Keep awake is unavailable in this browser.');
    }
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
          <div className="video-badges-row">
            <span
              className={`broadcast-live${state === 'streaming' ? ' is-watched' : ''}`}
              role="status"
            >
              <span aria-hidden="true" className="broadcast-live-dot" />
              {broadcastStatusLabel(state, viewerCount)}
            </span>
            <RecordingBadge state={clip.state} />
          </div>
          <div className="broadcast-top-actions">
            {canRecord && clip.supported && activeCameraId && (
              <button
                aria-pressed={clip.state.status === 'recording'}
                className={`broadcast-icon-button${
                  clip.state.status === 'recording' ? ' is-active' : ''
                }`}
                title={
                  clip.state.status === 'recording'
                    ? 'Tap to stop recording'
                    : clip.state.status === 'failed'
                      ? 'Retry encrypted upload'
                      : 'Record a short clip'
                }
                disabled={
                  clip.state.status === 'starting' ||
                  clip.state.status === 'uploading' ||
                  clip.state.status === 'available'
                }
                onClick={
                  clip.state.status === 'recording'
                    ? clip.stop
                    : clip.state.status === 'failed'
                      ? () => {
                          setError('');
                          clip.retry();
                        }
                      : startRecording
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
                            ? 'Retry encrypted recording upload'
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
        <div className="broadcast-footer">
          <div className="broadcast-identity">
            <span className="broadcast-eyebrow">THIS DEVICE IS A CAMERA</span>
            <strong>{deviceName}</strong>
            <span>
              {viewerCount === 1 ? '1 viewer' : `${viewerCount} viewers`} · Keep
              this tab open
            </span>
          </div>
          <div className="broadcast-controls">
            {inputs.length > 1 && (
              <button
                className="broadcast-icon-button"
                type="button"
                aria-label="Switch to next camera"
                disabled={clipBusy}
                onClick={() => {
                  const index = inputs.findIndex(
                    (input) => input.deviceId === activeSourceKey.current,
                  );
                  void registerAndStart(
                    inputs[(index + 1) % inputs.length]!.deviceId,
                  );
                }}
              >
                <Icon name="refresh" />
              </button>
            )}
            <button
              className="broadcast-stop"
              aria-label="Stop Camera Mode"
              onClick={stop}
              type="button"
            >
              <Icon name="camera" /> Stop camera
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
            {error}{' '}
            {clip.state.status === 'failed' && (
              <button
                className="link"
                onClick={() => {
                  clip.reset();
                  setError('');
                }}
                type="button"
              >
                Discard clip
              </button>
            )}
          </p>
        )}
        <p className="visually-hidden" role="status">
          Camera: {state} · Viewers: {viewerCount} · Reconnects: {retryCount}
        </p>
        {settingsOpen && (
          <ModalDialog
            className="broadcast-settings"
            labelledBy="cameraSettingsTitle"
            onDismiss={() => setSettingsOpen(false)}
          >
            <h2 id="cameraSettingsTitle">Camera settings</h2>
            {retryCount > 0 && (
              <p className="local-hint" role="status">
                {retryCount} reconnect{retryCount === 1 ? '' : 's'} so far
              </p>
            )}
            <div className="local-field">
              <label htmlFor="activeDeviceName">Device name</label>
              <input
                id="activeDeviceName"
                value={deviceName}
                maxLength={100}
                disabled={clipBusy}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </div>
            <div className="local-field">
              <label htmlFor="activeCameraSelect">Camera</label>
              <select
                id="activeCameraSelect"
                value={selectedKey}
                onChange={(event) => setSelectedKey(event.target.value)}
                disabled={clipBusy}
              >
                {inputs.map((input) => (
                  <option key={input.deviceId} value={input.deviceId}>
                    {input.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="local-field">
              <label htmlFor="activeCameraName">Camera name</label>
              <input
                id="activeCameraName"
                value={sourceNames[selectedKey] ?? ''}
                maxLength={100}
                disabled={clipBusy}
                onChange={(event) =>
                  setSourceNames((current) => ({
                    ...current,
                    [selectedKey]: event.target.value,
                  }))
                }
              />
            </div>
            {wakeLockSupported() && (
              <label className="local-check full">
                <input
                  checked={wakeLockEnabled}
                  type="checkbox"
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    wakeLockEnabledRef.current = enabled;
                    setWakeLockEnabled(enabled);
                    try {
                      localStorage.setItem(WAKE_LOCK_KEY, String(enabled));
                    } catch {
                      // Camera Mode still works with a session-only preference.
                    }
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
            )}
            <div className="heading-actions">
              <button
                type="button"
                onClick={() => void registerAndStart()}
                disabled={clipBusy}
              >
                Save changes
              </button>
              <button className="secondary" onClick={onBack} type="button">
                Back to dashboard
              </button>
            </div>
            <div className="local-hint">
              Saving briefly reconnects this camera to apply changes.
            </div>
          </ModalDialog>
        )}
      </main>
    );
  }

  const setup = (
    <section
      className="local-modal"
      role={standalone ? undefined : 'dialog'}
      aria-modal={standalone ? undefined : true}
    >
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
              ? standalone
                ? 'Enter a one-time code from a signed-in Beacon account, then choose this camera.'
                : 'Select the camera Beacon should use on this device.'
              : 'Keep this browser open while the camera is active. A Beacon account is needed to pair it.'}
          </p>
        </div>
      </div>

      <div className="local-steps">
        <span className="local-step on"></span>
        <span className={`local-step ${inputs.length > 0 ? 'on' : ''}`}></span>
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
            {standalone && (
              <div className="local-field full">
                <label htmlFor="browserPairingCode">Pairing code</label>
                <input
                  id="browserPairingCode"
                  autoComplete="off"
                  inputMode="text"
                  maxLength={32}
                  value={pairingCode}
                  onChange={(event) =>
                    setPairingCode(event.target.value.toUpperCase())
                  }
                  placeholder="Code from the account owner's Add camera screen"
                />
                <div className="local-hint">
                  Already paired in this browser? Leave the code blank to
                  resume.
                </div>
                {!scannerOpen && (
                  <button
                    className="btn secondary local-scan-button"
                    type="button"
                    onClick={() => setScannerOpen(true)}
                  >
                    Scan pairing QR code
                  </button>
                )}
                {scannerOpen && (
                  <PairingCodeScanner
                    onCode={(code) => {
                      setPairingCode(code);
                      setScannerOpen(false);
                    }}
                    onClose={() => setScannerOpen(false)}
                  />
                )}
              </div>
            )}
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
            {wakeLockSupported() && (
              <label className="local-check full">
                <input
                  checked={wakeLockEnabled}
                  type="checkbox"
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    wakeLockEnabledRef.current = enabled;
                    setWakeLockEnabled(enabled);
                    try {
                      localStorage.setItem(WAKE_LOCK_KEY, String(enabled));
                    } catch {
                      // Camera Mode still works with a session-only preference.
                    }
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
            )}
          </div>
          <div className="local-actions">
            <button className="btn secondary" onClick={onBack}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void registerAndStart()}
            >
              {standalone
                ? pairingCode.trim()
                  ? 'Pair and start camera'
                  : 'Resume camera'
                : 'Start camera'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
  if (standalone)
    return (
      <main className="broadcast-setup-page">
        <div className="broadcast-setup-wrap">
          <a
            href="/"
            aria-label="Beacon home"
            className="broadcast-setup-brand"
          >
            <Brand />
          </a>
          {setup}
          <p className="broadcast-setup-note">
            Camera use remains visible in your browser. Stop Camera Mode
            whenever you want to stop capture.
          </p>
        </div>
      </main>
    );
  return (
    <ModalDialog labelledBy="localTitle" onDismiss={onBack}>
      {setup}
    </ModalDialog>
  );
}
