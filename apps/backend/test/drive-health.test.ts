import { beforeEach, describe, expect, it, vi } from 'vitest';

// What Google answers to a token refresh in each test.
const google = vi.hoisted(() => ({
  calls: 0,
  refresh: (): Promise<string> => Promise.resolve('token'),
}));

vi.mock('../src/google-drive-client.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/google-drive-client.js')>();
  return {
    ...actual,
    refreshDriveAccessToken: () => {
      google.calls += 1;
      return google.refresh();
    },
  };
});

const drive = await import('../src/google-drive-client.js');
const { DriveHealth, DRIVE_HEALTH_CHECK_INTERVAL_MS } =
  await import('../src/drive-connection-health.js');

function fakeStore(scopes = drive.GOOGLE_DRIVE_RECORDING_SCOPE) {
  let expired = false;
  let connected = true;
  return {
    audit: vi.fn().mockResolvedValue(undefined),
    getGoogleDriveConnection: vi.fn(() =>
      Promise.resolve(
        connected && !expired
          ? { providerEmail: null, scopes, updatedAt: new Date() }
          : null,
      ),
    ),
    getGoogleDriveRefreshToken: vi.fn(() =>
      Promise.resolve(connected && !expired ? 'refresh' : null),
    ),
    googleDriveConnectionExpired: vi.fn(() =>
      Promise.resolve(connected && expired),
    ),
    markGoogleDriveConnectionExpired: vi.fn(() => {
      if (expired) return Promise.resolve(false);
      expired = true;
      return Promise.resolve(true);
    }),
    disconnect: () => {
      connected = false;
    },
  };
}

const config = {
  GOOGLE_OAUTH_CLIENT_ID: 'client',
  GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/callback',
};

describe('Drive health', () => {
  beforeEach(() => {
    google.calls = 0;
    google.refresh = () => Promise.resolve('token');
  });

  it('marks a rejected token expired once and asks for a reconnect from then on', async () => {
    const store = fakeStore();
    const health = new DriveHealth(store as never, config);
    google.refresh = () =>
      Promise.reject(new drive.DriveReconnectRequiredError());
    expect(await health.problem('user', 'home', 'recordings')).toBe(
      'drive_reconnect_required',
    );
    expect(await health.problem('user', 'home', 'recordings')).toBe(
      'drive_reconnect_required',
    );
    expect(store.audit).toHaveBeenCalledTimes(1);
  });

  it('never blocks or disconnects on a transient failure', async () => {
    const store = fakeStore();
    const health = new DriveHealth(store as never, config);
    google.refresh = () => Promise.reject(new Error('socket hang up'));
    expect(await health.problem('user', 'home', 'recordings')).toBeNull();
    expect(store.markGoogleDriveConnectionExpired).not.toHaveBeenCalled();
  });

  it('refreshes at most hourly, but notices a disconnect at once', async () => {
    let now = 1_000;
    const store = fakeStore();
    const health = new DriveHealth(store as never, config, () => now);
    expect(await health.problem('user', 'home', 'recordings')).toBeNull();
    expect(await health.problem('user', 'home', 'recordings')).toBeNull();
    expect(google.calls).toBe(1);
    now += DRIVE_HEALTH_CHECK_INTERVAL_MS;
    expect(await health.problem('user', 'home', 'recordings')).toBeNull();
    expect(google.calls).toBe(2);
    store.disconnect();
    expect(await health.problem('user', 'home', 'recordings')).toBe(
      'drive_not_connected',
    );
  });

  it('treats a backup-only connection as missing recording storage', async () => {
    const store = fakeStore(drive.GOOGLE_DRIVE_SCOPE);
    const health = new DriveHealth(store as never, config);
    expect(await health.problem('user', 'home', 'any')).toBeNull();
    expect(await health.problem('user', 'home', 'recordings')).toBe(
      'drive_not_connected',
    );
  });
});
