/**
 * How a browser or desktop camera uses its lens (ADR 0083).
 *
 * - `always`: the camera stays on while Camera Mode runs (the original
 *   behavior), so a viewer sees video instantly.
 * - `standby`: Camera Mode stays connected and shows as ready, but the camera
 *   and microphone stay off until someone opens the live view. They turn
 *   off again shortly after the last viewer leaves.
 */
export type CameraPower = 'always' | 'standby';

/** What the person at the device should be told is happening right now. */
export type CameraActivity = 'off' | 'standby' | 'live';

/** Grace period before a standby camera turns off after the last viewer
 * leaves, so a quick reconnect or camera switch doesn't flap the lens. */
export const STANDBY_RELEASE_DELAY_MS = 20_000;

const POWER_KEY = 'beacon_browser_camera_power';
const MICROPHONE_KEY = 'beacon_browser_camera_microphone';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice stays in effect for this session only.
  }
}

export function loadCameraPower(): CameraPower {
  return read(POWER_KEY) === 'standby' ? 'standby' : 'always';
}

export function saveCameraPower(power: CameraPower): void {
  write(POWER_KEY, power);
}

export function loadMicrophoneEnabled(): boolean {
  return read(MICROPHONE_KEY) === 'true';
}

export function saveMicrophoneEnabled(enabled: boolean): void {
  write(MICROPHONE_KEY, String(enabled));
}

const MICROPHONE_DEVICE_KEY = 'beacon_browser_camera_microphone_device';

/** The chosen microphone's device ID, or '' for the system default. */
export function loadMicrophoneDevice(): string {
  return read(MICROPHONE_DEVICE_KEY) ?? '';
}

export function saveMicrophoneDevice(deviceId: string): void {
  write(MICROPHONE_DEVICE_KEY, deviceId);
}

export function microphoneConstraints(
  deviceId: string,
): MediaTrackConstraints | true {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

export function cameraActivity(
  registered: boolean,
  streamOpen: boolean,
): CameraActivity {
  if (!registered) return 'off';
  return streamOpen ? 'live' : 'standby';
}

interface AutoStartRequest {
  microphone?: boolean;
  power?: CameraPower;
}

/**
 * `?autostart=1` starts Camera Mode without the two setup clicks. The
 * desktop app uses it to resume a camera after the computer restarts and to
 * finish one-click setup; optional `power` and `mic` carry the chosen mode.
 * Starting capture still requires the browser/OS camera permission.
 */
export function readAutoStartRequest(search: string): AutoStartRequest | null {
  const params = new URLSearchParams(search);
  if (params.get('autostart') !== '1') return null;
  const request: AutoStartRequest = {};
  const power = params.get('power');
  if (power === 'always' || power === 'standby') request.power = power;
  const mic = params.get('mic');
  if (mic === '1' || mic === '0') request.microphone = mic === '1';
  return request;
}
