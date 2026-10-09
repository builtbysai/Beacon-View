export interface DiagnosticSnapshot {
  unavailable?: Array<'cameras' | 'devices'>;
  cameras: Array<{
    cameraId: string;
    captureState: string;
    availability?: string;
    facing: string;
    viewerConnectionIds: string[];
    viewerCount: number;
  }>;
  devices: Array<{
    connectionState: string;
    deviceId: string;
    lastHeartbeatAt: string | null;
    platform: string;
  }>;
}

function known(value: string | undefined, allowed: readonly string[]): string {
  return value && allowed.includes(value) ? value : 'unknown';
}

export function heartbeatSummary(value: string | null, at: Date): string {
  if (!value) return 'No heartbeat';
  const age = at.getTime() - Date.parse(value);
  if (!Number.isFinite(age) || age < -5_000) return 'Heartbeat time unknown';
  return age <= 90_000 ? 'Recent heartbeat' : 'Older heartbeat';
}

/** Construct a fresh allowlisted object; never serialize the API response. */
export function diagnosticReport(
  snapshot: DiagnosticSnapshot,
  at: Date,
): string {
  const unavailable = ['devices', 'cameras'].filter((section) =>
    snapshot.unavailable?.includes(section as 'devices' | 'cameras'),
  );
  return JSON.stringify(
    {
      reportVersion: 1,
      checkedAt: at.toISOString(),
      scope:
        'Backend connection snapshot; media and notification delivery not tested',
      unavailable,
      devices: unavailable.includes('devices')
        ? []
        : snapshot.devices.map((device, index) => ({
            device: index + 1,
            platform: known(device.platform, [
              'android',
              'browser',
              'desktop',
              'web',
            ]),
            connection: known(device.connectionState, [
              'online',
              'offline',
              'disabled',
              'revoked',
            ]),
            heartbeat: heartbeatSummary(device.lastHeartbeatAt, at),
          })),
      cameras: unavailable.includes('cameras')
        ? []
        : snapshot.cameras.map((camera, index) => ({
            camera: index + 1,
            availability: known(camera.availability, ['online', 'offline']),
            facing: known(camera.facing, [
              'front',
              'rear',
              'external',
              'unknown',
            ]),
            capture: known(camera.captureState, ['idle', 'streaming']),
            viewers:
              Number.isInteger(camera.viewerCount) &&
              camera.viewerCount >= 0 &&
              camera.viewerCount <= 10_000
                ? camera.viewerCount
                : null,
          })),
    },
    null,
    2,
  );
}

export function connectionGuidance(state: string): string {
  if (state === 'online')
    return 'The device is checking in. Open live view to test video and audio.';
  if (state === 'offline')
    return 'Check the camera device’s internet connection and reopen Beacon. On Android, check that camera mode is running.';
  if (state === 'disabled')
    return 'This device is paused. Review its camera settings before enabling it.';
  if (state === 'revoked')
    return 'Device access was removed. Pair it again only if you want to restore access.';
  return 'Refresh to check this device again.';
}
