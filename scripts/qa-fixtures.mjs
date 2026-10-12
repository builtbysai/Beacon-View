// Fixture data for the local, offline QA scripts (Test-BeaconResponsive.mjs and Capture-BeaconScreens.mjs).
// Shapes match the web viewer's own types; nothing here reaches a real service.
export const now = new Date().toISOString();
export const cameras = ['Hallway', 'Garden', 'Bedroom', 'Garage'].map(
  (name, i) => ({
    id: `camera-${i}`,
    deviceId: `phone-${i}`,
    deviceName: `${name} phone`,
    name,
    online: i !== 3,
    platform: 'android',
    facing: 'rear',
    enabled: true,
    streaming: false,
    viewerCount: 0,
    lastSeenAt: now,
    credentialRevoked: false,
    capabilities: {},
    availability: 'idle',
    privacyMode: i === 2,
    sourceKey: 'rear',
  }),
);
export const devices = cameras.map((c) => ({
  id: c.deviceId,
  name: c.deviceName,
  platform: 'android',
  deviceType: 'phone',
  online: c.online,
  privacyMode: c.privacyMode,
  revoked: false,
  enabled: true,
  lastSeenAt: now,
  batteryPercent: 82,
  batteryCharging: true,
}));
devices.push({
  id: 'pending-phone',
  name: 'New camera phone',
  platform: 'android',
  deviceType: 'phone',
  online: false,
  privacyMode: false,
  revoked: false,
  enabled: true,
  lastSeenAt: null,
  batteryPercent: null,
  batteryCharging: null,
});
export const routes = {
  '/api/auth/me': {
    user: { id: 'responsive-qa', email: 'household@example.test' },
  },
  '/api/cameras': { cameras },
  '/api/devices': { devices },
  '/api/account/sessions': {
    sessions: [
      {
        id: 'session-1',
        current: true,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now,
      },
    ],
  },
  '/api/access-history': {
    events: [
      'live_view_started',
      'live_view_rejected',
      'privacy_enabled',
      'privacy_disabled',
      'device_credential_revoked',
      'camera_source_deleted',
      'device_deleted',
      'device_self_removed',
    ].map((eventType, index) => ({
      actorEmail: 'household@example.test',
      cameraName: eventType === 'camera_source_deleted' ? 'Rear camera' : null,
      deviceName: index > 5 ? 'Old hallway phone' : 'Hallway phone',
      eventType,
      occurredAt: new Date(Date.now() - index * 60_000).toISOString(),
      reason: eventType === 'live_view_rejected' ? 'camera_offline' : null,
      success: eventType !== 'live_view_rejected',
      viewerSessionId: null,
    })),
  },
  '/api/motion-retention': { days: 30 },
  '/api/devices/phone-0/motion-settings': { cameras: [] },
  '/api/devices/phone-2/motion-settings': { cameras: [] },
  '/api/devices/phone-3/motion-settings': { cameras: [] },
  '/api/motion-events': {
    events: [
      {
        id: 'event-1',
        cameraId: 'camera-0',
        cameraName: 'Hallway',
        deviceName: 'Hallway phone',
        confidence: 0.62,
        occurredAt: now,
      },
    ],
    nextCursor: null,
  },
  '/api/diagnostics': { devices: [], cameras: [] },
  '/api/notification-preferences': {
    preferences: cameras.map((camera, index) => ({
      deviceId: camera.deviceId,
      deviceName: camera.deviceName,
      motionEnabled: index === 0,
      offlineEnabled: index < 2,
      quietHours:
        index === 0
          ? {
              start: '22:00',
              end: '07:00',
              timeZone: 'America/New_York',
            }
          : null,
    })),
  },
  '/api/pairing-codes': { code: 'ABCD234567' },
  // Guest and shared-clip pages (no account): /g/demo-token and /shared/demo-token.
  '/api/guest/enter': { ok: true },
  '/api/guest/cameras': { cameras: cameras.slice(0, 2) },
  '/api/shared-recordings/demo-token': {
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
  // Endpoints added after this audit was first written; shapes match the
  // web viewer's own types (capabilities.ts, HouseholdSwitcher.tsx,
  // HouseholdSharingSettings.tsx, GoogleDriveSettings.tsx, MotionEventList.tsx).
  '/api/capabilities': {
    auth: { google: true },
    contact: true,
    googleDrive: true,
    notifications: { firebase: false, webPush: true },
    realtime: true,
    recordings: true,
  },
  '/api/household/mode': {
    mode: 'home',
    source: 'manual',
    changedAt: now,
    canChange: true,
    settings: {
      muteMotionWhenHome: true,
      pauseCamerasWhenHome: false,
      resumeCamerasWhenAway: false,
      schedule: null,
    },
  },
  '/api/cast-config': { appId: null },
  '/api/account/households': {
    households: [
      { expiresAt: null, id: 'household-1', name: 'Home', role: 'owner' },
    ],
  },
  '/api/household/sharing': { invitations: [], members: [] },
  '/api/household/guest-links': { guestLinks: [] },
  '/api/drive/status': {
    configured: true,
    connected: false,
    providerEmail: null,
    recordingsConnected: false,
    updatedAt: null,
  },
  '/api/activity': { events: [], total: 0 },
};

/** What /downloads/manifest.json lists on the live server. */
export const downloadsManifest = {
  files: [
    ['windows', 'x64', 'installer', 'Beacon-Setup-0.4.1-x64.exe'],
    ['macos', 'arm64', 'dmg', 'Beacon-0.4.1-arm64.dmg'],
    ['linux', 'x64', 'appimage', 'Beacon-0.4.1-x86_64.AppImage'],
    ['android', 'universal', 'apk', 'Beacon-android-0.1.0-alpha11.apk'],
  ].map(([platform, arch, kind, file]) => ({
    arch,
    bytes: 100_000_000,
    file,
    kind,
    platform,
    sha256: 'a'.repeat(64),
  })),
  publishedAt: new Date().toISOString(),
  version: '0.4.1',
};
