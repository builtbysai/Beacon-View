import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { request } from './api';
import { deviceLifecycle, nextPairingState } from './lifecycle';
import type { PairingLifecycle } from './lifecycle';
import { LiveVideo } from './LiveVideo';
import { BrowserCameraMode } from './BrowserCameraMode';

interface User {
  id: string;
  email: string;
}

interface Camera {
  id: string;
  deviceId: string;
  deviceName: string;
  name: string;
  online: boolean;
  platform: 'android' | 'browser';
  facing: string;
  enabled: boolean;
  streaming: boolean;
  viewerCount: number;
  lastSeenAt: string | null;
  credentialRevoked: boolean;
}

interface Device {
  id: string;
  name: string;
  platform: 'android' | 'browser';
  deviceType: string;
  online: boolean;
  lastSeenAt: string | null;
  revoked: boolean;
}

type Page =
  | 'dashboard'
  | 'cameras'
  | 'devices'
  | 'camera mode'
  | 'settings'
  | 'diagnostics';

const pagePaths: Record<Page, string> = {
  'camera mode': '/camera-mode',
  cameras: '/cameras',
  dashboard: '/',
  devices: '/devices',
  diagnostics: '/diagnostics',
  settings: '/settings',
};

function pageFromPath(): Page {
  if (window.location.pathname.startsWith('/devices/')) return 'devices';
  if (window.location.pathname.startsWith('/cameras/')) return 'cameras';
  return (
    (Object.entries(pagePaths).find(
      ([, path]) => path === window.location.pathname,
    )?.[0] as Page | undefined) ?? 'dashboard'
  );
}

function eventsUrl(): string {
  const url = new URL('/api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>(pageFromPath);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingState, setPairingState] = useState<PairingLifecycle>('pending');
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    () => {
      const match = window.location.pathname.match(/^\/devices\/([^/]+)$/);
      return match ? decodeURIComponent(match[1]!) : null;
    },
  );
  const [highlightedCameraId, setHighlightedCameraId] = useState<string | null>(
    null,
  );
  const returnPage = useRef<Page>('cameras');

  const navigate = useCallback((next: Page) => {
    window.history.pushState({}, '', pagePaths[next]);
    setPage(next);
    setSelectedDeviceId(null);
    setSelectedCamera(null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPage(pageFromPath());
      const deviceMatch =
        window.location.pathname.match(/^\/devices\/([^/]+)$/);
      const cameraMatch =
        window.location.pathname.match(/^\/cameras\/([^/]+)$/);
      setSelectedDeviceId(
        deviceMatch ? decodeURIComponent(deviceMatch[1]!) : null,
      );
      setSelectedCamera(
        cameraMatch
          ? (cameras.find(
              (camera) => camera.id === decodeURIComponent(cameraMatch[1]!),
            ) ?? null)
          : null,
      );
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [cameras]);

  const loadCameras = useCallback(async () => {
    const [cameraResult, deviceResult] = await Promise.all([
      request<{ cameras: Camera[] }>('/api/cameras'),
      request<{ devices: Device[] }>('/api/devices'),
    ]);
    setCameras(cameraResult.cameras);
    setDevices(deviceResult.devices);
    const cameraMatch = window.location.pathname.match(/^\/cameras\/([^/]+)$/);
    if (cameraMatch) {
      setSelectedCamera(
        cameraResult.cameras.find(
          (camera) => camera.id === decodeURIComponent(cameraMatch[1]!),
        ) ?? null,
      );
    }
    return cameraResult.cameras;
  }, []);

  useEffect(() => {
    void request<{ user: User }>('/api/auth/me')
      .then(async (result) => {
        setUser(result.user);
        await loadCameras();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [loadCameras]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let retry = 0;

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => {
        retry = 0;
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          cameraId?: string;
          type: string;
        };
        if (
          message.type === 'camera-paired' ||
          message.type === 'camera-presence-changed' ||
          message.type === 'device-credential-revoked'
        ) {
          void loadCameras().then(() => {
            if (message.type === 'camera-paired' && message.cameraId) {
              setPairingState((state) => nextPairingState(state, 'completed'));
              setHighlightedCameraId(message.cameraId);
              window.setTimeout(() => setHighlightedCameraId(null), 5_000);
              window.setTimeout(() => {
                setPairingOpen(false);
                setPairingCode('');
                navigate('cameras');
              }, 900);
            }
          });
        }
      };
      socket.onclose = (event) => {
        if (!active || event.code === 4003) return;
        const delay = Math.min(1_000 * 2 ** retry, 15_000);
        retry += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [loadCameras, navigate, user]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await request<{ user: User }>(`/api/auth/${mode}`, {
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
        method: 'POST',
      });
      setUser(result.user);
      await loadCameras();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    }
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setCameras([]);
    setDevices([]);
    setPairingOpen(false);
  }

  function openPairing() {
    returnPage.current = page;
    setPairingState('pending');
    setPairingCode('');
    setPairingOpen(true);
  }

  async function createPairingCode() {
    setError('');
    try {
      const result = await request<{ code: string }>('/api/pairing-codes', {
        body: '{}',
        method: 'POST',
      });
      setPairingCode(result.code);
      setPairingState((state) => nextPairingState(state, 'code-created'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    }
  }

  function cancelPairing() {
    setPairingState((state) => nextPairingState(state, 'cancelled'));
    setPairingOpen(false);
    setPairingCode('');
    navigate(returnPage.current);
  }

  async function updateCamera(
    cameraId: string,
    changes: { enabled?: boolean; name?: string },
  ) {
    await request(`/api/cameras/${cameraId}`, {
      body: JSON.stringify(changes),
      method: 'PATCH',
    });
    await loadCameras();
  }

  async function renameDevice(device: Device) {
    const name = window.prompt('Device name', device.name)?.trim();
    if (!name || name === device.name) return;
    await request(`/api/devices/${device.id}`, {
      body: JSON.stringify({ name }),
      method: 'PATCH',
    });
    await loadCameras();
  }

  async function revokeDevice(deviceId: string) {
    await request(`/api/devices/${deviceId}`, { method: 'DELETE' });
    await loadCameras();
  }

  function openDevice(deviceId: string) {
    window.history.pushState(
      {},
      '',
      `/devices/${encodeURIComponent(deviceId)}`,
    );
    setPage('devices');
    setSelectedDeviceId(deviceId);
    setSelectedCamera(null);
  }

  function openCamera(camera: Camera) {
    window.history.pushState(
      {},
      '',
      `/cameras/${encodeURIComponent(camera.id)}`,
    );
    setSelectedCamera(camera);
  }

  if (loading)
    return <main className="shell">Loading your secure workspace…</main>;

  if (!user) {
    return (
      <main className="shell auth-shell">
        <section className="card auth-card" aria-labelledby="page-title">
          <p className="eyebrow">Private by design</p>
          <h1 id="page-title">Beacon SecureView</h1>
          <p>Sign in to manage and watch your household cameras.</p>
          <form onSubmit={(event) => void authenticate(event)}>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={12}
                required
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button type="submit">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <button
            className="link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            type="button"
          >
            {mode === 'login'
              ? 'Create a new account'
              : 'Use an existing account'}
          </button>
        </section>
      </main>
    );
  }

  if (selectedCamera) {
    const siblings = cameras.filter(
      (camera) => camera.deviceId === selectedCamera.deviceId,
    );
    return (
      <LiveVideo
        camera={selectedCamera}
        onBack={() => {
          setSelectedCamera(null);
          openDevice(selectedCamera.deviceId);
        }}
        onSelectCamera={(cameraId) => {
          const sibling = siblings.find((camera) => camera.id === cameraId);
          if (sibling) openCamera(sibling);
        }}
        siblingCameras={siblings}
      />
    );
  }

  if (page === 'camera mode') {
    return <BrowserCameraMode onBack={() => navigate('dashboard')} />;
  }

  const onlineCount = cameras.filter((camera) => camera.online).length;
  const streamingCount = cameras.filter((camera) => camera.streaming).length;
  const activeViewers = cameras.reduce(
    (total, camera) => total + camera.viewerCount,
    0,
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Beacon</p>
          <h1>SecureView</h1>
        </div>
        <nav aria-label="Primary navigation">
          {(
            [
              'dashboard',
              'cameras',
              'devices',
              'camera mode',
              'settings',
              'diagnostics',
            ] as const
          ).map((item) => (
            <button
              className={page === item ? 'nav-active' : 'nav-button'}
              key={item}
              onClick={() => navigate(item)}
            >
              {item[0]!.toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <button className="secondary" onClick={() => void logout()}>
          Sign out
        </button>
      </aside>
      <main className="workspace">
        <header className="page-heading">
          <div>
            <p className="eyebrow">{user.email}</p>
            <h2>{page[0]!.toUpperCase() + page.slice(1)}</h2>
          </div>
          <div className="heading-actions">
            <button
              className="secondary"
              onClick={() => navigate('camera mode')}
            >
              Use this browser as a camera
            </button>
            <button onClick={openPairing}>Pair Android device</button>
          </div>
        </header>
        {error && <p role="alert">{error}</p>}
        {page === 'dashboard' && (
          <section className="dashboard-grid">
            <article className="metric-card">
              <span>Devices</span>
              <strong>{devices.length}</strong>
            </article>
            <article className="metric-card">
              <span>Cameras</span>
              <strong>{cameras.length}</strong>
            </article>
            <article className="metric-card">
              <span>Streaming</span>
              <strong>{streamingCount}</strong>
            </article>
            <article className="metric-card">
              <span>Active viewers</span>
              <strong>{activeViewers}</strong>
            </article>
            <article className="metric-card">
              <span>Online now</span>
              <strong>{onlineCount}</strong>
            </article>
            <article className="card camera-summary">
              <h3>Camera status</h3>
              <CameraList
                cameras={cameras}
                highlightedCameraId={highlightedCameraId}
                onLive={setSelectedCamera}
                onUpdate={(id, changes) => void updateCamera(id, changes)}
              />
            </article>
          </section>
        )}
        {page === 'cameras' && (
          <section className="card wide">
            <h3>Your cameras</h3>
            <CameraList
              cameras={cameras}
              highlightedCameraId={highlightedCameraId}
              onLive={setSelectedCamera}
              onUpdate={(id, changes) => void updateCamera(id, changes)}
            />
          </section>
        )}
        {page === 'devices' && (
          <section className="card wide">
            {selectedDeviceId ? (
              <DeviceDetail
                cameras={cameras.filter(
                  (camera) => camera.deviceId === selectedDeviceId,
                )}
                device={devices.find(
                  (device) => device.id === selectedDeviceId,
                )}
                onBack={() => {
                  window.history.pushState({}, '', '/devices');
                  setSelectedDeviceId(null);
                }}
                onLive={openCamera}
                onRename={(device) => void renameDevice(device)}
                onRevoke={(deviceId) => void revokeDevice(deviceId)}
                onUpdate={(id, changes) => void updateCamera(id, changes)}
              />
            ) : (
              <>
                <h3>Devices</h3>
                {devices.length === 0 && (
                  <p className="empty">
                    No devices yet. Pair Android or use this browser as a
                    camera.
                  </p>
                )}
                <ul className="device-list">
                  {devices.map((device) => (
                    <li key={device.id}>
                      <div>
                        <strong>{device.name}</strong>
                        <span>
                          {device.platform} · {device.deviceType}
                        </span>
                      </div>
                      <span className={device.online ? 'online' : 'offline'}>
                        {device.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                      <span>
                        {
                          cameras.filter(
                            (camera) => camera.deviceId === device.id,
                          ).length
                        }{' '}
                        camera sources
                      </span>
                      <button onClick={() => openDevice(device.id)}>
                        Open device
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        {page === 'diagnostics' && <Diagnostics />}
        {page === 'settings' && (
          <section className="card wide">
            <h3>Household settings</h3>
            <p>
              Camera credentials can be revoked from the Cameras page. Audio,
              recording, and cloud storage are not enabled.
            </p>
          </section>
        )}
      </main>
      {pairingOpen && (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="pair-title"
            aria-modal="true"
            className="pair-modal"
            role="dialog"
          >
            {pairingState === 'completed' ? (
              <div className="pair-success" role="status">
                <span aria-hidden="true">✓</span>
                <h2 id="pair-title">Camera connected</h2>
                <p>Taking you to Cameras…</p>
              </div>
            ) : (
              <>
                <p className="eyebrow">New camera</p>
                <h2 id="pair-title">Pair a device</h2>
                <p>
                  Create a one-time code, then enter it on the Android camera.
                </p>
                {pairingCode ? (
                  <div className="pairing" role="status">
                    <strong>{pairingCode}</strong>
                    <span>Waiting for the camera · expires in 10 minutes</span>
                  </div>
                ) : (
                  <button onClick={() => void createPairingCode()}>
                    Create pairing code
                  </button>
                )}
                <button className="secondary" onClick={cancelPairing}>
                  Cancel
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DeviceDetail({
  cameras,
  device,
  onBack,
  onLive,
  onRename,
  onRevoke,
  onUpdate,
}: {
  cameras: Camera[];
  device: Device | undefined;
  onBack: () => void;
  onLive: (camera: Camera) => void;
  onRename: (device: Device) => void;
  onRevoke: (deviceId: string) => void;
  onUpdate: (
    cameraId: string,
    changes: { enabled?: boolean; name?: string },
  ) => void;
}) {
  if (!device) {
    return (
      <>
        <h3>Device not found</h3>
        <p>This device is unavailable or does not belong to your household.</p>
        <button onClick={onBack}>Back to devices</button>
      </>
    );
  }
  const viewers = cameras.reduce(
    (total, camera) => total + camera.viewerCount,
    0,
  );
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">
            {device.platform} · {device.deviceType}
          </p>
          <h3>{device.name}</h3>
        </div>
        <button className="secondary" onClick={onBack}>
          Back to devices
        </button>
      </div>
      <p>
        Device:{' '}
        {device.revoked
          ? 'authentication revoked'
          : device.online
            ? 'online'
            : 'offline'}
        {' · '}Last seen: {device.lastSeenAt ?? 'never'}
        {' · '}Total viewers: {viewers}
      </p>
      <p className="notice">
        This device currently supports one active camera source at a time.
        Switching sources preserves the device registration.
      </p>
      <div className="heading-actions">
        <button className="secondary" onClick={() => onRename(device)}>
          Rename device
        </button>
        <button
          className="secondary"
          disabled={device.revoked}
          onClick={() => onRevoke(device.id)}
        >
          {device.revoked ? 'Device revoked' : 'Revoke device'}
        </button>
      </div>
      <h4>Camera sources</h4>
      <CameraList
        cameras={cameras}
        highlightedCameraId={null}
        onLive={onLive}
        onUpdate={onUpdate}
      />
    </>
  );
}

function Diagnostics() {
  const [diagnostics, setDiagnostics] = useState<{
    cameras: Array<{
      cameraId: string;
      captureState: string;
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
  } | null>(null);

  useEffect(() => {
    void request<NonNullable<typeof diagnostics>>('/api/diagnostics').then(
      setDiagnostics,
    );
  }, []);

  return (
    <section className="card wide">
      <h3>Development diagnostics</h3>
      {!diagnostics ? (
        <p>Loading sanitized connection diagnostics...</p>
      ) : (
        <>
          <h4>Devices</h4>
          <ul className="device-list">
            {diagnostics.devices.map((device) => (
              <li key={device.deviceId}>
                <strong>{device.platform}</strong>
                <span>{device.connectionState}</span>
                <span>{device.lastHeartbeatAt ?? 'No heartbeat'}</span>
              </li>
            ))}
          </ul>
          <h4>Camera sessions</h4>
          <ul className="device-list">
            {diagnostics.cameras.map((camera) => (
              <li key={camera.cameraId}>
                <strong>{camera.facing}</strong>
                <span>Capture: {camera.captureState}</span>
                <span>Viewers: {camera.viewerCount}</span>
                <span>
                  Connections: {camera.viewerConnectionIds.join(', ') || 'none'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="notice">
        Diagnostics use public identifiers and never include credentials, SDP,
        raw ICE candidates, or household IDs.
      </p>
    </section>
  );
}

function CameraList({
  cameras,
  highlightedCameraId,
  onLive,
  onUpdate,
}: {
  cameras: Camera[];
  highlightedCameraId: string | null;
  onLive: (camera: Camera) => void;
  onUpdate: (
    cameraId: string,
    changes: { enabled?: boolean; name?: string },
  ) => void;
}) {
  if (cameras.length === 0) {
    return <p className="empty">No cameras are paired with this household.</p>;
  }
  return (
    <ul className="camera-list">
      {cameras.map((camera) => {
        const state = deviceLifecycle(camera.online);
        return (
          <li
            className={
              highlightedCameraId === camera.id ? 'camera-highlight' : ''
            }
            key={camera.id}
          >
            <div>
              <strong>{camera.name}</strong>
              <span>
                {camera.deviceName} · {camera.facing}
              </span>
              <span className={state}>{state.toUpperCase()}</span>
              <span>
                {camera.viewerCount}{' '}
                {camera.viewerCount === 1 ? 'viewer' : 'viewers'}
              </span>
            </div>
            <button
              className="secondary"
              onClick={() => {
                const name = window.prompt('Camera name', camera.name)?.trim();
                if (name && name !== camera.name) onUpdate(camera.id, { name });
              }}
            >
              Rename
            </button>
            <button
              className="secondary"
              disabled={camera.credentialRevoked}
              onClick={() => onUpdate(camera.id, { enabled: !camera.enabled })}
            >
              {camera.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              disabled={
                !camera.enabled || !camera.online || camera.credentialRevoked
              }
              onClick={() => onLive(camera)}
            >
              View live
            </button>
          </li>
        );
      })}
    </ul>
  );
}
