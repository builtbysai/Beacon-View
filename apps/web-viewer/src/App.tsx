import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { request } from './api';
import { nextPairingState } from './lifecycle';
import { cameraStatus } from './camera-status';
import { deviceGuidance } from './device-guidance';
import type { PairingLifecycle } from './lifecycle';
import { LiveVideo } from './LiveVideo';
import { CameraTile } from './CameraTile';
import { ModalDialog } from './ModalDialog';
import { BrowserCameraMode } from './BrowserCameraMode';
import { MotionEventList } from './MotionEventList';
import { MotionSettingsPanel } from './MotionSettingsPanel';
import { MotionRetentionSettings } from './MotionRetentionSettings';
import { BrowserSessions } from './BrowserSessions';
import { AuthScreen } from './AuthScreen';
import { SplashScreen } from './SplashScreen';
import { CameraBrowser } from './CameraBrowser';
import { ContactPage } from './ContactPage';
import { Brand, Icon, type IconName } from './Icon';
import { Sidebar } from './Sidebar';

interface User {
  id: string;
  email: string;
  avatarUrl?: string | null;
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
  capabilities?: Record<string, boolean | number | string>;
  availability?: string;
  privacyMode?: boolean;
  sourceKey?: string;
}

interface Device {
  id: string;
  name: string;
  platform: 'android' | 'browser';
  deviceType: string;
  online: boolean;
  lastSeenAt: string | null;
  revoked: boolean;
  enabled: boolean;
  privacyMode?: boolean;
  softwareVersion?: string | null;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
  healthReportedAt?: string | null;
  capabilities?: Record<string, boolean | number | string>;
}

interface AccessEvent {
  actorEmail: string | null;
  deviceName: string | null;
  eventType: 'live_view_started' | 'live_view_rejected';
  occurredAt: string;
  success: boolean;
}

type Page =
  | 'dashboard'
  | 'cameras'
  | 'devices'
  | 'camera mode'
  | 'settings'
  | 'diagnostics'
  | 'events'
  | 'trust'
  | 'contact'
  | 'account deletion';

const SPLASH_SEEN_KEY = 'beacon.splash.seen.v1';

const pagePaths: Record<Page, string> = {
  'camera mode': '/camera-mode',
  cameras: '/cameras',
  dashboard: '/',
  devices: '/devices',
  diagnostics: '/diagnostics',
  events: '/events',
  settings: '/settings',
  trust: '/trust',
  contact: '/contact',
  'account deletion': '/account-deletion',
};

const pageLabels: Record<Page, string> = {
  dashboard: 'Home',
  cameras: 'Cameras',
  events: 'Activity',
  'camera mode': 'Add camera',
  devices: 'Devices',
  settings: 'Settings',
  trust: 'Trust and privacy',
  contact: 'Contact Beacon',
  'account deletion': 'Account deletion',
  diagnostics: 'Connection details',
};

const pageDescriptions: Record<Page, string> = {
  dashboard: 'A quick check on the cameras in your space.',
  cameras: 'Find a camera, watch it live, or view several at once.',
  events: 'Review motion activity from your devices.',
  devices: 'Manage camera access, power, and preferences.',
  'camera mode': 'Give a spare device a new purpose.',
  settings: 'Your account, security, and privacy preferences.',
  diagnostics: 'Details to help troubleshoot a connection.',
  trust: 'How Beacon handles capture and account data.',
  contact: 'Get help with your Beacon account or privacy request.',
  'account deletion': 'Request account deletion when you cannot sign in.',
};
const navigationIcons: Record<string, IconName> = {
  dashboard: 'home',
  cameras: 'camera',
  events: 'activity',
  devices: 'phone',
  settings: 'settings',
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

function pairingLink(code: string): string {
  const url = new URL('/pair', window.location.origin);
  url.searchParams.set('code', code);
  return url.toString();
}

function eventsUrl(): string {
  const url = new URL('/api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function relativeLastSeen(value: string | null): string {
  if (!value) return 'Never';
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function capabilitySummary(
  capabilities: Record<string, boolean | number | string> | undefined,
): string {
  if (!capabilities || Object.keys(capabilities).length === 0)
    return 'Standard video';
  return Object.entries(capabilities)
    .filter(([, value]) => value !== false)
    .map(([key, value]) =>
      value === true
        ? key.replaceAll('_', ' ')
        : `${key.replaceAll('_', ' ')}: ${String(value)}`,
    )
    .join(' · ');
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [splashSeen, setSplashSeen] = useState(() => {
    try {
      return localStorage.getItem(SPLASH_SEEN_KEY) === 'true';
    } catch {
      return true;
    }
  });
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>(pageFromPath);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingState, setPairingState] = useState<PairingLifecycle>('pending');
  const [browserCameraActive, setBrowserCameraActive] = useState(false);
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
  const [motionEventRevision, setMotionEventRevision] = useState(0);
  const [motionClearRevision, setMotionClearRevision] = useState(0);
  const returnPage = useRef<Page>('cameras');
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const priorPage = useRef(page);

  useEffect(() => {
    document.title = `${pageLabels[page]} · Beacon SecureView`;
    if (priorPage.current !== page) pageHeading.current?.focus();
    priorPage.current = page;
  }, [page]);

  const navigate = useCallback((next: Page) => {
    window.history.pushState({}, '', pagePaths[next]);
    setPage(next);
    setSelectedDeviceId(null);
    setSelectedCamera(null);
    setBrowserCameraActive(false);
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
    if (
      window.location.pathname === '/trust' ||
      window.location.pathname === '/pair' ||
      window.location.pathname === '/auth/mobile'
    )
      return;
    void request<{ user: User }>('/api/auth/me')
      .then(async (result) => {
        await loadCameras();
        setUser(result.user);
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
          message.type === 'device-credential-revoked' ||
          message.type === 'device-management-changed'
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
        if (
          message.type === 'motion-event-created' ||
          message.type === 'motion-history-cleared'
        ) {
          setMotionEventRevision((revision) => revision + 1);
          if (message.type === 'motion-history-cleared')
            setMotionClearRevision((revision) => revision + 1);
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
    if (authBusy) return;
    setAuthBusy(true);
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
      await loadCameras();
      setUser(result.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    } finally {
      setAuthBusy(false);
    }
  }

  function clearLocalSession() {
    setUser(null);
    setCameras([]);
    setDevices([]);
    setSelectedCamera(null);
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      clearLocalSession();
    }
    setPairingOpen(false);
  }

  function openPairing() {
    returnPage.current = page;
    setPairingState('pending');
    setPairingCode('');
    setPairingOpen(true);
    void createPairingCode();
  }

  async function createPairingCode() {
    setError('');
    setPairingBusy(true);
    try {
      const result = await request<{ code: string }>('/api/pairing-codes', {
        body: '{}',
        method: 'POST',
      });
      setPairingCode(result.code);
      setPairingState((state) => nextPairingState(state, 'code-created'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    } finally {
      setPairingBusy(false);
    }
  }

  function cancelPairing() {
    setPairingState((state) => nextPairingState(state, 'cancelled'));
    setPairingOpen(false);
    setPairingCode('');
    navigate(returnPage.current);
  }

  async function renameDevice(device: Device) {
    const name = window.prompt('Device name', device.name)?.trim();
    if (!name || name === device.name) return;
    try {
      setError('');
      await request(`/api/devices/${device.id}`, {
        body: JSON.stringify({ name }),
        method: 'PATCH',
      });
      await loadCameras();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rename failed');
    }
  }

  async function renameCamera(camera: Camera) {
    const name = window.prompt('Camera name', camera.name)?.trim();
    if (!name || name === camera.name) return;
    try {
      setError('');
      await request(`/api/cameras/${camera.id}`, {
        body: JSON.stringify({ name }),
        method: 'PATCH',
      });
      await loadCameras();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rename failed');
    }
  }

  async function deleteCamera(camera: Camera) {
    const warning =
      camera.viewerCount > 0
        ? ` ${camera.viewerCount} active viewer session(s) will be terminated.`
        : '';
    if (
      !window.confirm(
        `Permanently delete ${camera.name}? This camera source will be removed.${warning} The device must add it again.`,
      )
    )
      return;
    try {
      setError('');
      await request(`/api/cameras/${camera.id}`, { method: 'DELETE' });
      await loadCameras();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The camera could not be removed.',
      );
    }
  }

  async function deleteDevice(device: Device) {
    const viewerCount = cameras
      .filter((camera) => camera.deviceId === device.id)
      .reduce((total, camera) => total + camera.viewerCount, 0);
    const warning =
      viewerCount > 0
        ? ` ${viewerCount} active viewer session(s) will be terminated.`
        : '';
    if (
      !window.confirm(
        `Permanently delete ${device.name}? All camera sources and registration data will be removed.${warning} The device must be paired again.`,
      )
    )
      return;
    try {
      setError('');
      await request(`/api/devices/${device.id}`, { method: 'DELETE' });
      setSelectedDeviceId(null);
      window.history.pushState({}, '', '/cameras');
      setPage('cameras');
      await loadCameras();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The device could not be removed.',
      );
    }
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        'Permanently delete your Beacon account? This ends live sessions and removes your household, paired devices, camera settings, and motion metadata from Beacon. Encrypted backup copies expire on their normal schedule.',
      )
    )
      return;
    try {
      setError('');
      await request('/api/account', {
        body: JSON.stringify({ confirmation: 'DELETE' }),
        method: 'DELETE',
      });
      setPairingOpen(false);
      clearLocalSession();
      window.history.pushState({}, '', '/');
      setPage('dashboard');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Your account could not be deleted.',
      );
    }
  }

  async function setPrivacy(device: Device) {
    try {
      setError('');
      await request(`/api/devices/${device.id}/privacy`, {
        body: JSON.stringify({ enabled: !device.privacyMode }),
        method: 'PUT',
      });
      await loadCameras();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Privacy mode could not be changed.',
      );
    }
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

  if (window.location.pathname === '/pair') return <PairLinkPage />;
  if (window.location.pathname === '/auth/mobile')
    return <MobileAuthReturnPage />;
  if (page === 'trust') return <PublicTrustPage />;
  if (page === 'contact') return <ContactPage />;
  if (page === 'account deletion') return <ContactPage accountDeletion />;

  if (loading)
    return (
      <main className="shell loading-shell">
        <Brand />
        <p role="status">Opening your workspace…</p>
      </main>
    );

  if (!user && !splashSeen)
    return (
      <SplashScreen
        onContinue={() => {
          try {
            localStorage.setItem(SPLASH_SEEN_KEY, 'true');
          } catch {
            /* Splash just reappears next visit if storage is unavailable. */
          }
          setSplashSeen(true);
        }}
      />
    );

  if (!user)
    return (
      <AuthScreen
        mode={mode}
        busy={authBusy}
        error={error}
        onSubmit={(event) => void authenticate(event)}
        onMode={() => {
          setError('');
          setMode(mode === 'login' ? 'register' : 'login');
        }}
      />
    );

  if (selectedCamera) {
    const liveDevice = devices.find(
      (device) => device.id === selectedCamera.deviceId,
    );
    const siblings = cameras.filter(
      (camera) => camera.deviceId === selectedCamera.deviceId,
    );
    return (
      <LiveVideo
        camera={selectedCamera}
        enabled={selectedCamera.enabled && !selectedCamera.credentialRevoked}
        privacyMode={selectedCamera.privacyMode}
        onPrivacy={
          liveDevice?.platform === 'android'
            ? async () => {
                await request(`/api/devices/${liveDevice.id}/privacy`, {
                  body: JSON.stringify({ enabled: !liveDevice.privacyMode }),
                  method: 'PUT',
                });
                await loadCameras();
              }
            : undefined
        }
        deviceName={selectedCamera.deviceName}
        viewerCount={selectedCamera.viewerCount}
        onBack={() => navigate('cameras')}
        onSelectCamera={async (cameraId) => {
          const sibling = siblings.find((camera) => camera.id === cameraId);
          if (!sibling) return;
          await request(`/api/cameras/${cameraId}/activate`, {
            body: '{}',
            method: 'POST',
          });
          openCamera(sibling);
        }}
        siblingCameras={siblings}
      />
    );
  }

  if (page === 'camera mode' && browserCameraActive) {
    return <BrowserCameraMode onBack={() => setBrowserCameraActive(false)} />;
  }

  const onlineCount = cameras.filter(
    (camera) => cameraStatus(camera).available,
  ).length;
  const streamingCount = cameras.filter(
    (camera) => cameraStatus(camera).label === 'Live',
  ).length;
  const privacyCount = cameras.filter(
    (camera) => cameraStatus(camera).label === 'Privacy on',
  ).length;
  const attentionCount = cameras.filter(
    (camera) =>
      !cameraStatus(camera).available &&
      cameraStatus(camera).label !== 'Privacy on',
  ).length;
  const activeViewers = cameras.reduce(
    (total, camera) => total + camera.viewerCount,
    0,
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        email={user.email}
        avatarUrl={user.avatarUrl}
        onLogout={() => void logout()}
        items={(
          ['dashboard', 'cameras', 'events', 'devices', 'settings'] as const
        ).map((item) => ({
          label: pageLabels[item],
          icon: navigationIcons[item]!,
          current: page === item,
          onSelect: () => navigate(item),
        }))}
      />
      <main className="workspace" id="main-content" tabIndex={-1}>
        {page !== 'dashboard' && (
          <header className="page-heading">
            <div>
              <p className="eyebrow">Beacon / Your household</p>
              <h2 ref={pageHeading} tabIndex={-1}>
                {pageLabels[page]}
              </h2>
              <p className="page-description">{pageDescriptions[page]}</p>
            </div>
            {page !== 'camera mode' && (
              <button
                className="add-camera-button"
                aria-label="Add camera"
                onClick={() => navigate('camera mode')}
              >
                <Icon name="plus" />
                <span>Add camera</span>
              </button>
            )}
          </header>
        )}
        {error && <p role="alert">{error}</p>}
        {page === 'dashboard' && (
          <section className="home-dashboard">
            <div className="home-hero">
              <div>
                <h1 className="home-title" ref={pageHeading} tabIndex={-1}>
                  Home
                </h1>
                <h2>
                  {cameras.length === 0
                    ? 'Set up your first camera'
                    : attentionCount > 0
                      ? 'A camera needs your attention'
                      : streamingCount > 0
                        ? 'Live viewing is active'
                        : privacyCount === cameras.length
                          ? 'Your cameras are paused'
                          : 'Your cameras are ready'}
                </h2>
                <p>
                  {cameras.length === 0
                    ? 'Pair a spare Android phone or tablet to begin.'
                    : attentionCount > 0
                      ? 'Review what needs attention.'
                      : privacyCount === cameras.length
                        ? 'Privacy is on across every camera.'
                        : 'Choose a camera when you want to check in.'}
                </p>
              </div>
              <div className="home-hero-actions">
                <button onClick={() => navigate('camera mode')}>
                  <Icon name="plus" />
                  Add camera
                </button>
                {cameras.length > 0 && (
                  <button
                    className="secondary"
                    onClick={() => navigate('cameras')}
                  >
                    View all cameras
                  </button>
                )}
              </div>
            </div>
            {cameras.length > 0 && (
              <div className="home-metrics" aria-label="Camera overview">
                <article>
                  <span className="metric-icon ready" aria-hidden="true">
                    <Icon name="camera" />
                  </span>
                  <strong>{onlineCount}</strong>
                  <span>Ready to view</span>
                </article>
                <article>
                  <span className="metric-icon privacy" aria-hidden="true">
                    <Icon name="lock" />
                  </span>
                  <strong>{privacyCount}</strong>
                  <span>Privacy on</span>
                </article>
                <article>
                  <span className="metric-icon attention" aria-hidden="true">
                    <Icon name="alert" />
                  </span>
                  <strong>{attentionCount}</strong>
                  <span>Need attention</span>
                </article>
                <article>
                  <span className="metric-icon live" aria-hidden="true">
                    <Icon name="eye" />
                  </span>
                  <strong>{activeViewers}</strong>
                  <span>Watching now</span>
                </article>
              </div>
            )}
            <article className="card camera-summary">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Your cameras</p>
                  <h3>
                    {cameras.length === 0
                      ? 'Start with a spare Android device'
                      : 'Around your home'}
                  </h3>
                </div>
                {cameras.length > 0 && (
                  <button className="link" onClick={() => navigate('cameras')}>
                    See all cameras
                  </button>
                )}
              </div>
              {cameras.length === 0 && (
                <p>
                  Android is the everyday camera. This browser is for temporary,
                  attended setup.
                </p>
              )}
              {cameras.length > 0 && (
                <div className="camera-tile-grid">
                  {cameras.slice(0, 6).map((camera) => (
                    <CameraTile
                      key={camera.id}
                      camera={camera}
                      highlighted={highlightedCameraId === camera.id}
                      onOpen={openCamera}
                      onDevice={openDevice}
                      onRename={(item) => void renameCamera(item)}
                      onDelete={(item) => void deleteCamera(item)}
                    />
                  ))}
                </div>
              )}
            </article>
            {cameras.length === 0 && (
              <article
                className="card onboarding-steps"
                aria-labelledby="onboarding-steps-title"
              >
                <p className="eyebrow">How Beacon works</p>
                <h3 id="onboarding-steps-title">
                  Three steps to your first view
                </h3>
                <ol>
                  <li>
                    <span className="onboarding-step-icon">
                      <Icon name="phone" />
                    </span>
                    <div>
                      <strong>Turn a device into a camera</strong>
                      <p>
                        Use a spare Android phone or tablet for an everyday
                        camera, or this browser for a temporary one.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="onboarding-step-icon">
                      <Icon name="lock" />
                    </span>
                    <div>
                      <strong>Beacon connects it securely</strong>
                      <p>
                        A private, one-time pairing code links the camera to
                        your household only.
                      </p>
                    </div>
                  </li>
                  <li>
                    <span className="onboarding-step-icon">
                      <Icon name="eye" />
                    </span>
                    <div>
                      <strong>Watch it live, from anywhere</strong>
                      <p>
                        Open Beacon on any phone, tablet, or computer to check
                        in whenever you like.
                      </p>
                    </div>
                  </li>
                </ol>
              </article>
            )}
          </section>
        )}
        {page === 'cameras' && (
          <section className="camera-catalog wide" aria-label="Your cameras">
            <CameraBrowser cameras={cameras} key={user.id}>
              {(items) =>
                items.length === 0 ? (
                  <p className="empty">
                    No cameras are paired with this household.
                  </p>
                ) : (
                  <div className="camera-tile-grid">
                    {items.map((camera) => (
                      <CameraTile
                        key={camera.id}
                        camera={camera}
                        highlighted={highlightedCameraId === camera.id}
                        onOpen={openCamera}
                        onDevice={openDevice}
                        onRename={(item) => void renameCamera(item)}
                        onDelete={(item) => void deleteCamera(item)}
                      />
                    ))}
                  </div>
                )
              }
            </CameraBrowser>
          </section>
        )}
        {page === 'events' && (
          <MotionEventList
            filterStorageKey={`beacon_motion_filters_${user.id}`}
            refreshRevision={motionEventRevision}
            clearRevision={motionClearRevision}
            cameras={cameras}
            onCamera={(id) => {
              const camera = cameras.find((item) => item.id === id);
              if (camera) openCamera(camera);
            }}
          />
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
                  window.history.pushState({}, '', '/cameras');
                  setSelectedDeviceId(null);
                  setPage('cameras');
                }}
                onLive={openCamera}
                onRename={(device) => void renameDevice(device)}
                onDelete={(device) => void deleteDevice(device)}
                onCameraRename={(camera) => void renameCamera(camera)}
                onCameraDelete={(camera) => void deleteCamera(camera)}
                onPrivacy={(device) => void setPrivacy(device)}
              />
            ) : (
              <>
                <p className="eyebrow">Paired with your household</p>
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
                      <span>
                        Last seen {relativeLastSeen(device.lastSeenAt)}
                      </span>
                      <span>
                        {device.batteryPercent === null ||
                        device.batteryPercent === undefined
                          ? 'Battery not yet reported'
                          : `${device.batteryPercent}% battery${device.batteryCharging ? ' · charging' : ''}`}
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
          <div className="settings-layout wide">
            <section
              className="settings-section"
              aria-labelledby="account-section-title"
            >
              <h3 id="account-section-title">Account</h3>
              <div className="settings-row">
                <div>
                  <strong>Email</strong>
                  <p>{user.email}</p>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>This browser</strong>
                  <p>Sign out of Beacon on this device.</p>
                </div>
                <button className="secondary" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            </section>

            <section
              className="settings-section"
              aria-labelledby="security-section-title"
            >
              <h3 id="security-section-title">Security</h3>
              <BrowserSessions onCurrentRevoked={clearLocalSession} />
              <AccessHistory />
            </section>

            <section
              className="settings-section"
              aria-labelledby="camera-section-title"
            >
              <h3 id="camera-section-title">Camera &amp; motion</h3>
              <MotionRetentionSettings />
            </section>

            <section
              className="settings-section"
              aria-labelledby="privacy-section-title"
            >
              <h3 id="privacy-section-title">Privacy</h3>
              <div className="settings-row">
                <div>
                  <strong>Trust &amp; privacy</strong>
                  <p>
                    Viewing, listening, and talking are separate choices. See
                    how Beacon handles capture and account data.
                  </p>
                </div>
                <a className="secondary button-link" href="/trust">
                  Read more
                </a>
              </div>
            </section>

            <section
              className="settings-section settings-danger"
              aria-labelledby="danger-section-title"
            >
              <h3 id="danger-section-title">Danger zone</h3>
              <div className="settings-row">
                <div>
                  <strong>Delete this account</strong>
                  <p>
                    Permanently removes your household, devices, settings, and
                    motion metadata. Reauthenticate within 10 minutes; backup
                    copies expire on their normal schedule.
                  </p>
                </div>
                <button className="danger" onClick={() => void deleteAccount()}>
                  Delete account
                </button>
              </div>
            </section>
          </div>
        )}
        {page === 'camera mode' && (
          <section className="card wide">
            <p className="eyebrow">Add a camera</p>
            <h3>Choose how you want to use Beacon</h3>
            <p>
              Use Android for an everyday camera, or this browser for a
              temporary camera.
            </p>
            <div className="setup-options">
              <article>
                <span className="setup-icon">
                  <Icon name="phone" />
                </span>
                <span className="setup-badge">
                  Recommended for everyday use
                </span>
                <h4>Android phone or tablet</h4>
                <p>
                  Best for everyday use. Keep it powered for reliable background
                  camera operation.
                </p>
                <ol className="setup-steps">
                  <li>Open Beacon on your Android device.</li>
                  <li>Choose Camera and scan the pairing code.</li>
                  <li>Connect power and check the live view.</li>
                </ol>
                <button onClick={openPairing}>
                  Pair Android device
                  <Icon name="arrow" />
                </button>
              </article>
              <article>
                <span className="setup-icon">
                  <Icon name="browser" />
                </span>
                <span className="setup-badge neutral">
                  For a temporary setup
                </span>
                <h4>Use this browser</h4>
                <p>
                  Useful for a temporary setup. Keep this tab open while it is a
                  camera.
                </p>
                <button
                  className="secondary"
                  onClick={() => setBrowserCameraActive(true)}
                >
                  Use this browser as a camera
                </button>
              </article>
            </div>
            <p className="notice">
              Pair only a device you own or are authorized to use. Capture stays
              visible on the camera device.
            </p>
          </section>
        )}
      </main>
      {pairingOpen && (
        <ModalDialog labelledBy="pair-title" onDismiss={cancelPairing}>
          <section aria-labelledby="pair-title" className="pair-modal">
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
                  Scan with Beacon on Android, or share this one-time setup
                  link.
                </p>
                {pairingCode ? (
                  <div className="pairing" role="status">
                    <QRCodeSVG
                      aria-label="Beacon pairing QR code"
                      bgColor="#ffffff"
                      fgColor="#101820"
                      level="M"
                      marginSize={2}
                      size={180}
                      title="Scan with Beacon on Android"
                      value={pairingLink(pairingCode)}
                    />
                    <div className="pairing-code-copy">
                      <strong>{pairingCode}</strong>
                      <span>Expires in 10 minutes</span>
                      <button
                        className="secondary"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(pairingLink(pairingCode))
                            .catch(() =>
                              setError('Could not copy the setup link.'),
                            )
                        }
                      >
                        Copy setup link
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    disabled={pairingBusy}
                    onClick={() => void createPairingCode()}
                  >
                    {pairingBusy ? 'Preparing secure code…' : 'Try again'}
                  </button>
                )}
                {error && <p role="alert">{error}</p>}
                <button className="secondary" onClick={cancelPairing}>
                  Cancel
                </button>
              </>
            )}
          </section>
        </ModalDialog>
      )}
    </div>
  );
}

function PairLinkPage() {
  const code = new URLSearchParams(window.location.search)
    .get('code')
    ?.toUpperCase();
  const validCode = code?.match(/^[A-HJ-NP-Z2-9]{10}$/)?.[0];

  return (
    <main className="shell trust-shell pair-link-shell">
      <section className="trust-page" aria-labelledby="pair-link-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">New camera</p>
        <h1 id="pair-link-title">
          {validCode
            ? 'Open this link on your camera phone.'
            : 'That setup link is no longer available.'}
        </h1>
        {validCode ? (
          <>
            <p className="trust-lead">
              Beacon opens automatically when it is installed. Otherwise, open
              the Beacon Android app and enter this one-time code.
            </p>
            <p
              className="pair-link-code"
              aria-label={`Pairing code ${validCode}`}
            >
              {validCode}
            </p>
            <p className="pair-link-note">
              Only use this link on a device you own or are authorized to set
              up. It expires in 10 minutes.
            </p>
          </>
        ) : (
          <p className="trust-lead">
            Ask the account owner to create a fresh setup link. Pairing links
            are short-lived for your household’s security.
          </p>
        )}
        <a className="secondary button-link" href="/">
          Return to Beacon
        </a>
      </section>
    </main>
  );
}

function MobileAuthReturnPage() {
  const status = new URLSearchParams(window.location.hash.slice(1)).get(
    'status',
  );
  const message =
    status === 'linkRequired'
      ? 'This email already has a Beacon password account. Use that account in the app.'
      : status === 'failed'
        ? 'Google sign-in could not be completed. Return to Beacon and try again.'
        : 'Return to the Beacon Android app to finish signing in.';
  return (
    <main className="shell trust-shell pair-link-shell">
      <section className="trust-page" aria-labelledby="mobile-auth-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Beacon for Android</p>
        <h1 id="mobile-auth-title">Finish in Beacon.</h1>
        <p className="trust-lead">{message}</p>
        <a className="secondary button-link" href="/">
          Return to Beacon
        </a>
      </section>
    </main>
  );
}

function PublicTrustPage() {
  return (
    <main className="shell trust-shell">
      <section className="trust-page" aria-labelledby="trust-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Trust and privacy</p>
        <h1 id="trust-title">Your camera stays under your control.</h1>
        <p className="trust-lead">
          Beacon is built around one rule: nothing happens without your say.
          Capture stays visible, viewing is always explicit, and nothing is ever
          recorded.
        </p>

        <div className="trust-flow" aria-hidden="true">
          <span className="trust-flow-step">
            <Icon name="phone" />
            <span>Your device</span>
          </span>
          <span className="trust-flow-link" />
          <span className="trust-flow-step">
            <Icon name="lock" />
            <span>Encrypted link</span>
          </span>
          <span className="trust-flow-link" />
          <span className="trust-flow-step">
            <Icon name="browser" />
            <span>Your viewer</span>
          </span>
        </div>

        <div className="trust-principles">
          <div className="trust-principle">
            <span className="trust-principle-icon">
              <Icon name="lock" />
            </span>
            <div>
              <h2>Privacy you control</h2>
              <p>
                Turning privacy on stops camera and microphone capture
                immediately, from the device itself or remotely.
              </p>
            </div>
          </div>
          <div className="trust-principle">
            <span className="trust-principle-icon">
              <Icon name="eye" />
            </span>
            <div>
              <h2>Live means intentional</h2>
              <p>
                Opening a live view connects a camera on purpose. Listening and
                talking each need their own separate action.
              </p>
            </div>
          </div>
          <div className="trust-principle">
            <span className="trust-principle-icon">
              <Icon name="shield" />
            </span>
            <div>
              <h2>Nothing is recorded</h2>
              <p>
                No video, audio, thumbnails, or facial identities are ever saved
                — only account settings and motion-event metadata.
              </p>
            </div>
          </div>
          <div className="trust-principle">
            <span className="trust-principle-icon">
              <Icon name="settings" />
            </span>
            <div>
              <h2>Account controls</h2>
              <p>
                Review browser sessions, revoke access individually, and choose
                how long motion metadata is kept.
              </p>
            </div>
          </div>
        </div>

        <a className="secondary button-link trust-return" href="/">
          Return to Beacon
        </a>

        <p className="trust-alpha-note">
          Beacon is a private alpha — formal terms and a privacy policy are
          still coming. For support, privacy, or deletion questions, use the{' '}
          <a href="/contact">Beacon contact form</a>. Do not rely on Beacon for
          emergency response or life-safety monitoring.
        </p>
      </section>
    </main>
  );
}

function DeviceDetail({
  cameras,
  device,
  onBack,
  onLive,
  onDelete,
  onPrivacy,
  onRename,
  onCameraRename,
  onCameraDelete,
}: {
  cameras: Camera[];
  device: Device | undefined;
  onBack: () => void;
  onLive: (camera: Camera) => void;
  onDelete: (device: Device) => void;
  onPrivacy: (device: Device) => void;
  onRename: (device: Device) => void;
  onCameraRename: (camera: Camera) => void;
  onCameraDelete: (camera: Camera) => void;
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
  const connectionLabel = device.privacyMode
    ? 'Privacy mode on'
    : device.revoked
      ? 'Access revoked'
      : !device.enabled
        ? 'Registration disabled'
        : device.online
          ? 'Online'
          : 'Offline';
  const batteryLabel =
    device.batteryPercent === null || device.batteryPercent === undefined
      ? 'Not reported yet'
      : `${device.batteryPercent}%${device.batteryCharging ? ' · charging' : ''}`;
  const warning =
    device.online &&
    device.enabled &&
    !device.revoked &&
    !device.privacyMode &&
    device.batteryPercent !== null &&
    device.batteryPercent !== undefined &&
    device.batteryPercent <= 15 &&
    !device.batteryCharging
      ? 'Battery is low. Connect this camera to power to keep it available.'
      : null;
  const guidance = deviceGuidance({
    cameraCount: cameras.length,
    enabled: device.enabled,
    online: device.online,
    platform: device.platform,
    privacyMode: device.privacyMode,
    revoked: device.revoked,
  });
  return (
    <>
      <div className="heading device-heading">
        <div>
          <p className="eyebrow">
            {device.platform} · {device.deviceType}
          </p>
          <h3>{device.name}</h3>
        </div>
        <button
          className="secondary device-back-button"
          aria-label="Back to cameras"
          onClick={onBack}
        >
          <Icon name="chevronLeft" />
          <span>Cameras</span>
        </button>
      </div>
      <section className="device-health" aria-label="Device health">
        <div>
          <span>Connection</span>
          <strong
            className={
              device.online &&
              device.enabled &&
              !device.privacyMode &&
              !device.revoked
                ? 'online'
                : 'offline'
            }
          >
            {connectionLabel}
          </strong>
        </div>
        <div>
          <span>Last seen</span>
          <strong>{relativeLastSeen(device.lastSeenAt)}</strong>
        </div>
        <div>
          <span>Power</span>
          <strong>{batteryLabel}</strong>
        </div>
        <div>
          <span>Watching now</span>
          <strong>{viewers === 1 ? '1 viewer' : `${viewers} viewers`}</strong>
        </div>
      </section>
      {warning && (
        <p className="health-warning" role="status">
          {warning}
        </p>
      )}
      <details
        className={`device-guidance${guidance.attention ? ' attention' : ''}`}
      >
        <summary>
          <span>{guidance.title}</span>
          <span className="device-guidance-disclosure">
            {guidance.attention ? 'Troubleshoot' : 'Readiness tips'}
          </span>
        </summary>
        <div className="device-guidance-content">
          <p>{guidance.summary}</p>
          <ol>
            {guidance.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="device-guidance-boundary">
            The dashboard does not receive this device’s permission settings or
            inspect whether a local camera or microphone indicator is visible.
          </p>
        </div>
      </details>
      {device.platform === 'android' && (
        <section
          className="device-controls"
          aria-labelledby="device-privacy-title"
        >
          <div>
            <h4 id="device-privacy-title">Device privacy</h4>
            <p>
              Applies to every camera source on this phone. Local privacy is the
              fastest way to stop capture.
            </p>
          </div>
          <button
            className={device.privacyMode ? '' : 'secondary'}
            onClick={() => onPrivacy(device)}
          >
            {device.privacyMode ? 'Turn privacy off' : 'Turn privacy on'}
          </button>
        </section>
      )}
      <p className="notice device-source-note">
        This device currently supports one active camera source at a time.
        Switching sources preserves the device registration.
      </p>
      <h4>Camera sources</h4>
      {cameras.length === 0 ? (
        <p className="empty">No camera sources on this device.</p>
      ) : (
        <div className="camera-tile-grid">
          {cameras.map((camera) => (
            <CameraTile
              key={camera.id}
              camera={camera}
              onOpen={onLive}
              onRename={onCameraRename}
              onDelete={onCameraDelete}
            />
          ))}
        </div>
      )}
      <details className="device-settings">
        <summary>Device settings</summary>
        <div className="device-settings-content">
          <p>Capabilities: {capabilitySummary(device.capabilities)}</p>
          <p>
            Version: {device.softwareVersion ?? 'not reported'}
            {' · '}Registration: {device.enabled ? 'enabled' : 'disabled'}
            {' · '}Authentication: {device.revoked ? 'revoked' : 'valid'}
          </p>
          <div className="heading-actions">
            <button className="secondary" onClick={() => onRename(device)}>
              Edit name
            </button>
            <button className="danger" onClick={() => onDelete(device)}>
              Remove device
            </button>
          </div>
          <p className="notice">
            Removing this device disconnects every camera source registered to
            it. You can pair the device again later.
          </p>
        </div>
      </details>
      {device.platform === 'android' && !device.revoked && (
        <MotionSettingsPanel deviceId={device.id} cameras={cameras} />
      )}
    </>
  );
}

function AccessHistory() {
  const [events, setEvents] = useState<AccessEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void request<{ events: AccessEvent[] }>('/api/access-history')
      .then((result) => {
        if (active) setEvents(result.events);
      })
      .catch(() => {
        if (active) setError('Access history is temporarily unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-labelledby="access-history-title">
      <h4 id="access-history-title">Recent camera access</h4>
      <p className="notice">
        The latest 50 successful and rejected live-view attempts for this
        household. Network addresses and connection details are not shown.
      </p>
      {error && <p role="alert">{error}</p>}
      {events === null && !error && (
        <p role="status">Loading access history…</p>
      )}
      {events?.length === 0 && <p className="empty">No camera access yet.</p>}
      {events && events.length > 0 && (
        <ul className="access-list">
          {events.map((event, index) => (
            <li key={`${event.occurredAt}-${index}`}>
              <div>
                <strong>
                  {event.success ? 'Live view started' : 'Access rejected'}
                </strong>
                <span>{event.deviceName ?? 'Unknown camera device'}</span>
              </div>
              <span>{event.actorEmail ?? 'Unknown account'}</span>
              <span>{new Date(event.occurredAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
