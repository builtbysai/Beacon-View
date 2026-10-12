import { useEffect, useRef, useState } from 'react';
import { markBusy } from './busy';

import { ApiError, request } from './api';
import { friendlyError, mediaErrorMessage } from './friendly-errors';
import { BrowserProducer } from './BrowserProducer';
import { Brand, Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import { PairingCodeScanner } from './PairingCodeScanner';
import './BrowserCameraModeSetup.css';
import { browserOsLabel, friendlyDeviceLabel } from './naming';
import { RecordingBadge } from './RecordingBadge';
import { useClipRecorder } from './useClipRecorder';
import {
  DRIVE_READY,
  type DriveRecording,
  isDriveProblem,
} from './drive-recording';
import { DriveReconnectNotice, RecordClipControl } from './RecordClipControl';
import { rememberLocalBrowserDevice } from './browser-camera-local';
import {
  cameraActivity,
  type CameraPower,
  loadCameraPower,
  loadMicrophoneDevice,
  loadMicrophoneEnabled,
  microphoneConstraints,
  readAutoStartRequest,
  saveCameraPower,
  saveMicrophoneDevice,
  saveMicrophoneEnabled,
  STANDBY_RELEASE_DELAY_MS,
} from './camera-power';
import { desktopBridge, reportDesktopCameraActivity } from './desktop-shell';
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
/** Waits before each try to turn an always-on camera back on after it ended by itself. */
const RECOVERY_DELAYS_MS = [1_500, 8_000, 30_000];

/** A stream whose video has not ended. (A tracks without a state counts as live.) */
function streamIsLive(stream: MediaStream): boolean {
  const tracks = stream.getVideoTracks();
  return (
    tracks.length === 0 ||
    tracks.every((track) => !track.readyState || track.readyState === 'live')
  );
}

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
function broadcastStatusLabel(
  state: string,
  viewerCount: number,
  standby: boolean,
): string {
  if (state === 'streaming') {
    return viewerCount === 1 ? '1 watching' : `${viewerCount} watching`;
  }
  if (state === 'reconnecting') return 'Reconnecting…';
  if (state === 'error') return 'Offline';
  return standby ? 'Standby · camera off' : 'Camera Mode ready';
}

/** The path the desktop app reopens at startup to resume this camera. */
function resumePath(
  standalone: boolean,
  power: CameraPower,
  microphone: boolean,
): string {
  const params = new URLSearchParams({
    autostart: '1',
    mic: microphone ? '1' : '0',
    power,
  });
  return `${standalone ? '/camera-mode/setup' : '/camera-mode'}?${params.toString()}`;
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
  drive = DRIVE_READY,
  standalone = false,
}: {
  onBack: () => void;
  standalone?: boolean;
  /** Only the household owner can request recordings (see POST
   * /api/recordings) -- matches the same live-viewer gate in LiveVideo. */
  canRecord?: boolean;
  /** Whether recordings can be saved, and how to connect Drive. */
  drive?: DriveRecording;
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
  // Read once: the URL is cleaned up after the first render.
  const [autoStart] = useState(() => {
    const request = readAutoStartRequest(window.location.search);
    // A link carrying a pairing code would join someone else's household with
    // no one agreeing (V19). The desktop app asks first, before it opens this
    // page; in a plain browser the person finishes setup themselves.
    const carriesCode = new URLSearchParams(window.location.search).has('code');
    return request && carriesCode && !desktopBridge() ? null : request;
  });
  const autoStartPending = useRef(autoStart !== null);
  const [power, setPower] = useState<CameraPower>(
    () => autoStart?.power ?? loadCameraPower(),
  );
  const powerRef = useRef(power);
  powerRef.current = power;
  const [microphone, setMicrophone] = useState(
    () => autoStart?.microphone ?? loadMicrophoneEnabled(),
  );
  const microphoneRef = useRef(microphone);
  microphoneRef.current = microphone;
  const [streamOpen, setStreamOpen] = useState(false);
  const [talking, setTalking] = useState(false);
  const [microphones, setMicrophones] = useState<VideoInput[]>([]);
  const [microphoneId, setMicrophoneId] = useState(loadMicrophoneDevice);
  const microphoneIdRef = useRef(microphoneId);
  microphoneIdRef.current = microphoneId;
  const pendingStream = useRef<Promise<MediaStream> | null>(null);
  const releaseTimer = useRef<number | null>(null);
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
      if (releaseTimer.current !== null)
        window.clearTimeout(releaseTimer.current);
      producerRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void wakeLockRef.current?.release();
      // Leaving Camera Mode in-app ends it; a reload or quitting the app
      // never runs this, so the desktop app still resumes after a restart.
      desktopBridge()?.setCameraResume?.(null);
    };
  }, []);

  useEffect(() => {
    if (!backgrounded && wakeLockEnabled && streamRef.current) {
      void acquireWakeLock();
    }
  }, [backgrounded, wakeLockEnabled]);

  // The desktop app keeps running in the tray with its window hidden; it
  // shows whether this camera is live or on standby there.
  const activity = cameraActivity(activeCameraId !== null, streamOpen);
  useEffect(() => {
    if (activity === 'off') return;
    reportDesktopCameraActivity(activity);
    return () => reportDesktopCameraActivity('off');
  }, [activity]);

  // While Camera Mode runs inside the desktop app, the app reopens it after
  // the computer restarts. Stopping Camera Mode (or leaving it) clears that.
  const registered = activeCameraId !== null;
  useEffect(
    () => (registered ? markBusy('camera mode') : undefined),
    [registered],
  );
  useEffect(() => {
    if (!registered) return;
    desktopBridge()?.setCameraResume?.(
      resumePath(standalone, power, microphone),
    );
  }, [registered, standalone, power, microphone]);

  // Auto-start: run both setup steps without clicks once cameras are found.
  useEffect(() => {
    if (!autoStartPending.current) return;
    if (inputs.length === 0) {
      void discover();
      return;
    }
    autoStartPending.current = false;
    // registerAndStart reads this render's state; it only needs to run once
    // the camera list exists.
    void registerAndStart();
  }, [inputs]);

  function cancelRelease() {
    if (releaseTimer.current === null) return;
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  }

  function releaseStream() {
    cancelRelease();
    pendingStream.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    setStreamOpen(false);
  }

  /** A camera another app is just letting go of reports "busy" for a moment; one short retry covers it. */
  async function openCameraWithRetry(deviceId: string): Promise<MediaStream> {
    try {
      return await openCamera(deviceId);
    } catch (error) {
      const transient =
        error instanceof DOMException &&
        (error.name === 'NotReadableError' || error.name === 'AbortError');
      if (!transient) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      return openCamera(deviceId);
    }
  }

  async function openCamera(deviceId: string): Promise<MediaStream> {
    const video = {
      deviceId: { exact: deviceId },
      frameRate: { ideal: 24, max: 30 },
      height: { ideal: 720, max: 1080 },
      width: { ideal: 1280, max: 1920 },
    };
    const chosenMicrophone = microphoneIdRef.current;
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: microphoneRef.current
          ? microphoneConstraints(chosenMicrophone)
          : false,
        video,
      });
    } catch (error) {
      // The chosen microphone was unplugged: fall back to the default one
      // rather than failing the whole camera.
      if (
        microphoneRef.current &&
        chosenMicrophone &&
        error instanceof DOMException &&
        (error.name === 'OverconstrainedError' ||
          error.name === 'NotFoundError')
      )
        return navigator.mediaDevices.getUserMedia({ audio: true, video });
      throw error;
    }
  }

  /** Lists microphones. Their names need microphone permission, which is
   * asked for only once sound is turned on. */
  async function refreshMicrophones() {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      probe.getTracks().forEach((track) => track.stop());
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'audioinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label
            ? friendlyDeviceLabel(device.label)
            : 'Microphone ' + String(index + 1),
        }));
      setMicrophones(devices);
      if (
        microphoneIdRef.current &&
        !devices.some((device) => device.deviceId === microphoneIdRef.current)
      )
        setMicrophoneId('');
    } catch (error) {
      setMicrophones([]);
      setError(
        `This camera can’t share sound. ${mediaErrorMessage(error, 'microphone')}`,
      );
    }
  }

  function changeMicrophone(enabled: boolean) {
    setMicrophone(enabled);
    if (enabled) void refreshMicrophones();
  }

  function chooseMicrophone(deviceId: string) {
    setMicrophoneId(deviceId);
    saveMicrophoneDevice(deviceId);
  }

  function installStream(stream: MediaStream) {
    for (const track of stream.getVideoTracks()) {
      track.contentHint = 'motion';
      // The browser or the system can end a camera on its own: it was unplugged, another app took it,
      // the computer slept, or permission was withdrawn. Without noticing, a camera kept "streaming" black
      // video, and a standby camera handed that dead stream to the next viewer.
      track.addEventListener?.('ended', () => handleTrackEnded(stream), {
        once: true,
      });
    }
    streamRef.current = stream;
    if (previewRef.current) previewRef.current.srcObject = stream;
    setStreamOpen(true);
  }

  /** The camera ended on its own (see installStream). A standby camera simply lets go, so the next viewer
   * opens it again; an always-on camera is started again, a few times, before giving up out loud. */
  function handleTrackEnded(stream: MediaStream) {
    if (streamRef.current !== stream) return;
    releaseStream();
    const key = activeSourceKey.current;
    if (!key || powerRef.current === 'standby') return;
    void recoverCamera(key);
  }

  async function recoverCamera(key: string) {
    for (const delay of RECOVERY_DELAYS_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (activeSourceKey.current !== key) return; // stopped or switched meanwhile
      await registerAndStartRef.current(key);
      if (streamRef.current) {
        setError('');
        return;
      }
    }
    if (activeSourceKey.current !== key) return;
    stop();
    setError(
      'The camera stopped, and Beacon could not turn it back on. Another app may be using it, or it was unplugged. Start the camera again.',
    );
  }

  /** Opens (or reuses) the camera for `deviceId` when a standby camera
   * wakes. Concurrent viewers share one getUserMedia call. */
  function acquireStream(deviceId: string): Promise<MediaStream> {
    cancelRelease();
    if (streamRef.current) {
      if (streamIsLive(streamRef.current))
        return Promise.resolve(streamRef.current);
      // Never hand a viewer a camera that has already ended.
      releaseStream();
    }
    if (pendingStream.current) return pendingStream.current;
    const generation = startGeneration.current;
    const pending = openCameraWithRetry(deviceId)
      .then((stream) => {
        if (generation !== startGeneration.current) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error('Camera Mode changed while the camera was starting');
        }
        installStream(stream);
        return stream;
      })
      .finally(() => {
        if (pendingStream.current === pending) pendingStream.current = null;
      });
    pendingStream.current = pending;
    return pending;
  }

  /** In standby, turn the camera off once nobody has watched for a while. */
  function scheduleStandbyRelease(viewers: number) {
    if (powerRef.current !== 'standby' || viewers > 0) {
      cancelRelease();
      return;
    }
    if (!streamRef.current || releaseTimer.current !== null) return;
    releaseTimer.current = window.setTimeout(() => {
      releaseTimer.current = null;
      if (clipBusyRef.current) {
        scheduleStandbyRelease(0);
        return;
      }
      releaseStream();
    }, STANDBY_RELEASE_DELAY_MS);
  }

  async function discover() {
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices) {
      setError(
        'Camera Mode needs a secure connection. Open Beacon from its https:// address.',
      );
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
      if (microphoneRef.current) void refreshMicrophones();
      setSourceNames(
        Object.fromEntries(
          devices.map((device) => [device.deviceId, device.label]),
        ),
      );
      setSelectedKey((current) => current || devices[0]?.deviceId || '');
    } catch (caught) {
      setError(mediaErrorMessage(caught, 'camera'));
    }
  }

  const registerAndStartRef = useRef<(key?: string) => Promise<void>>(() =>
    Promise.resolve(),
  );

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
      const deviceId = selected.deviceId;
      // Always-on opens the new camera before releasing the current one, so
      // a failed switch leaves the working camera running. Standby opens
      // nothing until a viewer arrives.
      const fresh = power === 'always' ? await openCamera(deviceId) : null;
      if (generation !== startGeneration.current) {
        fresh?.getTracks().forEach((track) => track.stop());
        return;
      }
      producerRef.current?.stop();
      releaseStream();
      if (fresh) installStream(fresh);
      saveCameraPower(power);
      saveMicrophoneEnabled(microphone);
      activeSourceKey.current = deviceId;
      setSelectedKey(deviceId);
      setActiveCameraId(camera.id);
      producerRef.current = new BrowserProducer(
        camera.id,
        fresh ?? (() => acquireStream(deviceId)),
        (next, viewers, retries) => {
          if (next === 'error') {
            stop();
            setError(
              'Beacon lost access to the camera. Allow camera access in your browser’s site settings, then start the camera again.',
            );
            return;
          }
          setState(next);
          setViewerCount(viewers);
          setRetryCount(retries);
          scheduleStandbyRelease(viewers);
        },
        (cameraId) => {
          const source = result.cameras.find((item) => item.id === cameraId);
          const nextKey = source?.sourceKey.replace(/^browser:/, '');
          if (!nextKey || nextKey === selected.deviceId) return;
          setSelectedKey(nextKey);
          void registerAndStart(nextKey);
        },
        (wakeError) =>
          setError(
            `Someone tried to view this camera, but it couldn’t turn on. ${mediaErrorMessage(
              wakeError,
              microphoneRef.current ? 'camera and microphone' : 'camera',
            )}`,
          ),
        setTalking,
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
          : caught instanceof DOMException
            ? mediaErrorMessage(
                caught,
                microphoneRef.current ? 'camera and microphone' : 'camera',
              )
            : friendlyError(caught, 'The camera couldn’t start. Try again.'),
      );
    }
  }

  registerAndStartRef.current = registerAndStart;

  function stop() {
    startGeneration.current += 1;
    producerRef.current?.stop();
    producerRef.current = null;
    releaseStream();
    activeSourceKey.current = null;
    setActiveCameraId(null);
    desktopBridge()?.setCameraResume?.(null);
    setState('offline');
    setViewerCount(0);
    void wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }

  function startRecording() {
    setError('');
    if (streamRef.current) {
      clip.start(streamRef.current);
      return;
    }
    // A standby camera turns on for the recording and goes back to standby
    // once it ends and nobody is watching.
    const deviceId = activeSourceKey.current;
    if (!deviceId) return;
    void acquireStream(deviceId).then(
      (stream) => clip.start(stream),
      (error: unknown) =>
        setError(
          `The camera couldn’t turn on to record. ${mediaErrorMessage(error, 'camera')}`,
        ),
    );
  }

  useEffect(() => {
    if (!clipBusy) scheduleStandbyRelease(viewerCount);
    // Only re-evaluate when a recording finishes.
  }, [clipBusy]);

  // Clears a finished clip's status back to the plain record control a few
  // seconds after it lands, matching the live viewer's own record button.
  useEffect(() => {
    if (clip.state.status !== 'available') return;
    const timer = window.setTimeout(() => clip.reset(), 6_000);
    return () => window.clearTimeout(timer);
  }, [clip.reset, clip.state.status]);

  // A Drive problem has its own notice with a fix; others show here.
  useEffect(() => {
    if (clip.state.error && !isDriveProblem(clip.state.errorCode))
      setError(clip.state.error);
  }, [clip.state.error, clip.state.errorCode]);

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
        {talking && (
          <p className="broadcast-talking" role="status">
            <Icon name="speaker" /> Someone is talking through this camera
          </p>
        )}
        {activity === 'standby' && (
          <div className="broadcast-standby" role="status">
            <Icon name="camera" />
            <strong>Camera is off</strong>
            <span>
              It turns on by itself when someone opens the live view, and turns
              off again after they leave.
            </span>
          </div>
        )}
        <div className="broadcast-top">
          <div className="video-badges-row">
            <span
              className={`broadcast-live${state === 'streaming' ? ' is-watched' : ''}`}
              role="status"
            >
              <span aria-hidden="true" className="broadcast-live-dot" />
              {broadcastStatusLabel(state, viewerCount, activity === 'standby')}
            </span>
            <RecordingBadge state={clip.state} />
          </div>
          <div className="broadcast-top-actions">
            {canRecord && activeCameraId && (
              <RecordClipControl
                className="broadcast-icon-button"
                clip={clip}
                drive={drive}
                onStart={startRecording}
              />
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
              {viewerCount === 1 ? '1 viewer' : `${viewerCount} viewers`} ·{' '}
              {desktopBridge()
                ? 'Runs in the background'
                : 'Keep this tab open'}
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
        {canRecord && activeCameraId && (
          <DriveReconnectNotice
            className="on-broadcast"
            clip={clip}
            drive={drive}
          />
        )}
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
            <div className="broadcast-settings-panel">
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
              <CameraPowerFields
                idPrefix="active"
                disabled={clipBusy}
                microphone={microphone}
                power={power}
                microphoneId={microphoneId}
                microphones={microphones}
                onMicrophoneChange={changeMicrophone}
                onMicrophoneSelect={chooseMicrophone}
                onPowerChange={setPower}
              />
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
                  <span>
                    Keep this device awake while Camera Mode is active
                  </span>
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
            <CameraPowerFields
              idPrefix="setup"
              disabled={clipBusy}
              microphone={microphone}
              power={power}
              microphoneId={microphoneId}
              microphones={microphones}
              onMicrophoneChange={changeMicrophone}
              onMicrophoneSelect={chooseMicrophone}
              onPowerChange={setPower}
            />
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

function CameraPowerFields({
  disabled,
  idPrefix,
  microphone,
  microphoneId,
  microphones,
  onMicrophoneChange,
  onMicrophoneSelect,
  onPowerChange,
  power,
}: {
  disabled: boolean;
  idPrefix: string;
  microphone: boolean;
  microphoneId: string;
  microphones: { deviceId: string; label: string }[];
  onMicrophoneChange: (enabled: boolean) => void;
  onMicrophoneSelect: (deviceId: string) => void;
  onPowerChange: (power: CameraPower) => void;
  power: CameraPower;
}) {
  return (
    <fieldset className="local-field full camera-power" disabled={disabled}>
      <legend>When nobody is watching</legend>
      <label className="local-check">
        <input
          checked={power === 'always'}
          name={`${idPrefix}CameraPower`}
          onChange={() => onPowerChange('always')}
          type="radio"
        />
        <span>
          <b>Keep the camera on</b> — viewers see video instantly
        </span>
      </label>
      <label className="local-check">
        <input
          checked={power === 'standby'}
          name={`${idPrefix}CameraPower`}
          onChange={() => onPowerChange('standby')}
          type="radio"
        />
        <span>
          <b>Standby</b> — camera stays off until someone opens the live view
        </span>
      </label>
      <label className="local-check">
        <input
          checked={microphone}
          onChange={(event) => onMicrophoneChange(event.target.checked)}
          type="checkbox"
        />
        <span>Include sound so viewers can listen</span>
      </label>
      {microphone && microphones.length > 1 && (
        <label className="camera-power-microphone">
          <span>Microphone</span>
          <select
            onChange={(event) => onMicrophoneSelect(event.target.value)}
            value={microphoneId}
          >
            <option value="">System default</option>
            {microphones.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}
