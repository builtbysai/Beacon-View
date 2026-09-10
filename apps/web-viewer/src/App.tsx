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
import { ConfirmDialog } from './ConfirmDialog';
import { Avatar } from './Avatar';
import { CameraFlipButton } from './CameraFlipButton';
import { InlineRename } from './InlineRename';
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
import { deviceKindLabel } from './naming';
import {
  groupAccessEvents,
  rejectionReasonLabel,
  type AccessEvent,
} from './access-history';

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

// Devices is no longer a user-facing destination: a camera-owning phone,
// tablet, or computer is presented as one Camera (see groupByDevice below),
// managed from the Cameras page itself. The backend keeps its own
// device/camera-source distinction; only the frontend's navigation model
// changed.
type Page =
  | 'dashboard'
  | 'cameras'
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
  settings: 'Settings',
  trust: 'Trust and privacy',
  contact: 'Contact Beacon',
  'account deletion': 'Account deletion',
  diagnostics: 'Connection details',
};

const navigationIcons: Record<string, IconName> = {
  dashboard: 'home',
  cameras: 'camera',
  events: 'activity',
  settings: 'settings',
};

// Only routes where adding a camera is a genuinely relevant action get the
// header shortcut — a page shell action is opt-in per route, not a blanket
// default that every screen has to individually hide.
const pagesWithAddCamera: ReadonlySet<Page> = new Set(['cameras']);

// Desktop composition per page type: a camera grid earns extra width, a
// settings/reading page doesn't, and the header above each page must match
// its content's width or the two visibly disagree.
const pageContentWidth: Partial<Record<Page, 'medium' | 'wide'>> = {
  cameras: 'wide',
  'camera mode': 'medium',
  events: 'medium',
};

function contentWidthClass(page: Page): string {
  const width = pageContentWidth[page];
  return width ? `workspace-${width}` : '';
}

/** `/devices/:id` was the old device-detail destination; every other
 * surface now reaches the same content at `/cameras/:id/settings`. Redirect
 * rather than breaking a bookmarked or shared link. */
function legacyDeviceIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/devices\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function deviceSettingsIdFromPath(): string | null {
  const legacy = legacyDeviceIdFromPath();
  if (legacy) return legacy;
  const match = window.location.pathname.match(
    /^\/cameras\/([^/]+)\/settings$/,
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

function pageFromPath(): Page {
  if (
    window.location.pathname.startsWith('/devices/') ||
    window.location.pathname.startsWith('/cameras/')
  )
    return 'cameras';
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

/** Collapse a household's camera sources into one representative Camera per
 * host device (see the Page-level comment above for why). The active
 * source — streaming, else online, else the first registered — stands in
 * for the whole host in list/grid views; CameraSettings still lists every
 * source individually for switching. */
function groupCamerasByDevice(cameras: Camera[]): Camera[] {
  const byDevice = new Map<string, Camera[]>();
  for (const camera of cameras) {
    const sources = byDevice.get(camera.deviceId) ?? [];
    sources.push(camera);
    byDevice.set(camera.deviceId, sources);
  }
  return [...byDevice.values()].map(
    (sources) =>
      sources.find((source) => source.streaming) ??
      sources.find((source) => source.online) ??
      sources[0]!,
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
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const [page, setPage] = useState<Page>(pageFromPath);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingState, setPairingState] = useState<PairingLifecycle>('pending');
  const [browserCameraActive, setBrowserCameraActive] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  // When Camera settings is opened from the live viewer's own overflow menu,
  // its Back button should return to that viewer rather than the Cameras
  // grid. Cleared on every other path into Camera settings so a stale
  // reference never sends Back somewhere the user didn't come from.
  const [settingsReturnCameraId, setSettingsReturnCameraId] = useState<
    string | null
  >(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    deviceSettingsIdFromPath,
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
    document.title = `${pageLabels[page]} · Beacon`;
    if (priorPage.current !== page) pageHeading.current?.focus();
    priorPage.current = page;
  }, [page]);

  // Devices was removed as a user-facing destination; redirect a bookmarked
  // or shared /devices/:id link to its camera-centric equivalent instead of
  // breaking it.
  useEffect(() => {
    const legacyId = legacyDeviceIdFromPath();
    if (legacyId) {
      window.history.replaceState(
        {},
        '',
        `/cameras/${encodeURIComponent(legacyId)}/settings`,
      );
    }
  }, []);

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
      const cameraMatch =
        window.location.pathname.match(/^\/cameras\/([^/]+)$/);
      setSelectedDeviceId(deviceSettingsIdFromPath());
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

  const clearLocalSession = useCallback((message = '') => {
    setUser(null);
    setCameras([]);
    setDevices([]);
    setSelectedCamera(null);
    if (message) setError(message);
  }, []);

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
        if (!active) return;
        // 4001: this session was explicitly revoked or the account was
        // deleted, from another browser or by an admin action. 4003: the
        // connection's own periodic validity check found the session is no
        // longer valid (idle-expired, revoked, etc). Either way, stop
        // reconnecting and drop straight to sign-in instead of leaving the
        // tab sitting on stale authenticated UI until an API call 401s.
        if (event.code === 4001 || event.code === 4003) {
          clearLocalSession('You were signed out because this session ended.');
          return;
        }
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
  }, [clearLocalSession, loadCameras, navigate, user]);

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

  async function renameDevice(device: Device, name: string) {
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

  async function renameCamera(camera: Camera, name: string) {
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

  /** A grid tile represents the whole host device, so renaming it renames
   * the device (the user-facing camera's identity), not just whichever
   * source happens to be active right now. */
  function renameHostCamera(camera: Camera, name: string) {
    const device = devices.find((item) => item.id === camera.deviceId);
    if (device) void renameDevice(device, name);
  }

  function requestDeleteHostCamera(camera: Camera) {
    const device = devices.find((item) => item.id === camera.deviceId);
    if (device) requestDeleteDevice(device);
  }

  /** Switch which registered source is active for a device — the compact
   * flip control's action, and also reachable from Camera settings. */
  async function switchSource(camera: Camera) {
    try {
      setError('');
      await request(`/api/cameras/${camera.id}/activate`, {
        body: '{}',
        method: 'POST',
      });
      await loadCameras();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not switch camera.',
      );
    }
  }

  function requestDeleteCamera(camera: Camera) {
    const warning =
      camera.viewerCount > 0
        ? ` ${camera.viewerCount} active viewer session(s) will be terminated.`
        : '';
    setPendingConfirm({
      title: `Permanently delete ${camera.name}?`,
      description: `This camera will be removed.${warning} The device must add it again.`,
      confirmLabel: 'Delete camera',
      onConfirm: () => {
        setPendingConfirm(null);
        void deleteCamera(camera);
      },
    });
  }

  async function deleteCamera(camera: Camera) {
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

  function requestDeleteDevice(device: Device) {
    const viewerCount = cameras
      .filter((camera) => camera.deviceId === device.id)
      .reduce((total, camera) => total + camera.viewerCount, 0);
    const warning =
      viewerCount > 0
        ? ` ${viewerCount} active viewer session(s) will be terminated.`
        : '';
    setPendingConfirm({
      title: `Permanently delete ${device.name}?`,
      description: `Every camera paired to it will be removed.${warning} The device must be paired again.`,
      confirmLabel: 'Delete device',
      onConfirm: () => {
        setPendingConfirm(null);
        void deleteDevice(device);
      },
    });
  }

  async function deleteDevice(device: Device) {
    try {
      setError('');
      await request(`/api/devices/${device.id}`, { method: 'DELETE' });
      setSelectedDeviceId(null);
      setSelectedCamera(null);
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

  function requestDeleteAccount() {
    setPendingConfirm({
      title: 'Delete your Beacon account?',
      description:
        "This ends live sessions and removes your household, paired devices, camera settings, and motion history from Beacon. You'll need to reauthenticate within 10 minutes to confirm. Encrypted backup copies expire on their normal schedule.",
      confirmLabel: 'Delete account',
      onConfirm: () => {
        setPendingConfirm(null);
        void deleteAccount();
      },
    });
  }

  async function deleteAccount() {
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

  function openCameraSettings(deviceId: string, returnCameraId?: string) {
    window.history.pushState(
      {},
      '',
      `/cameras/${encodeURIComponent(deviceId)}/settings`,
    );
    setPage('cameras');
    setSelectedDeviceId(deviceId);
    setSelectedCamera(null);
    setSettingsReturnCameraId(returnCameraId ?? null);
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
  if (page === 'trust')
    return (
      <PublicTrustPage
        returnHref={user ? '/settings' : '/'}
        returnLabel={user ? 'Back to Settings' : 'Return to Beacon'}
      />
    );
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
      <>
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
          onDevice={() =>
            openCameraSettings(selectedCamera.deviceId, selectedCamera.id)
          }
          onRename={(name) => renameHostCamera(selectedCamera, name)}
          onDelete={() => requestDeleteHostCamera(selectedCamera)}
        />
        {pendingConfirm && (
          <ConfirmDialog
            title={pendingConfirm.title}
            description={pendingConfirm.description}
            confirmLabel={pendingConfirm.confirmLabel}
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm(null)}
          />
        )}
      </>
    );
  }

  if (page === 'camera mode' && browserCameraActive) {
    return <BrowserCameraMode onBack={() => setBrowserCameraActive(false)} />;
  }

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
  // One physical host (phone, tablet, or computer) is one user-facing
  // Camera, even when it has multiple lenses/sources registered. The
  // backend keeps cameras and devices distinct; this is purely a frontend
  // presentation grouping.
  const hostCameras = groupCamerasByDevice(cameras);
  const pendingDevices = devices.filter(
    (device) => !cameras.some((camera) => camera.deviceId === device.id),
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
        items={(['dashboard', 'cameras', 'events', 'settings'] as const).map(
          (item) => ({
            label: pageLabels[item],
            icon: navigationIcons[item]!,
            current: page === item,
            onSelect: () => navigate(item),
          }),
        )}
      />
      <main className="workspace" id="main-content" tabIndex={-1}>
        {page !== 'dashboard' && (
          <header
            className={`page-heading ${selectedDeviceId ? 'workspace-medium' : contentWidthClass(page)}`}
          >
            <h2 ref={pageHeading} tabIndex={-1}>
              {pageLabels[page]}
            </h2>
            {pagesWithAddCamera.has(page) && !selectedDeviceId && (
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
        {page === 'dashboard' && cameras.length === 0 && (
          <section className="home-dashboard home-dashboard-empty workspace-wide">
            <h1 className="home-title" ref={pageHeading} tabIndex={-1}>
              Add your first camera
            </h1>
            <p>Turn a spare phone, tablet, or computer into a camera.</p>
            <div className="home-hero-actions">
              <button onClick={() => navigate('camera mode')}>
                <Icon name="plus" />
                Add camera
              </button>
              <a className="link" href="/trust">
                How privacy works
              </a>
            </div>
          </section>
        )}
        {page === 'dashboard' && cameras.length > 0 && (
          <section className="home-dashboard workspace-wide">
            <div className="home-hero-compact">
              <h1 className="home-title" ref={pageHeading} tabIndex={-1}>
                {attentionCount > 0
                  ? 'A camera needs your attention'
                  : streamingCount > 0
                    ? 'Live viewing is active'
                    : privacyCount === cameras.length
                      ? 'Your cameras are paused'
                      : 'Your cameras are ready'}
              </h1>
              <button
                className="secondary"
                onClick={() => navigate('camera mode')}
              >
                <Icon name="plus" />
                Add camera
              </button>
            </div>
            <div className="camera-tile-grid">
              {hostCameras.map((camera) => (
                <CameraTile
                  key={camera.deviceId}
                  camera={camera}
                  groupedByHost
                  highlighted={highlightedCameraId === camera.id}
                  onOpen={openCamera}
                  onDevice={openCameraSettings}
                  onRename={(item, name) => renameHostCamera(item, name)}
                  onDelete={(item) => requestDeleteHostCamera(item)}
                />
              ))}
            </div>
            {pendingDevices.length > 0 && (
              <ul className="device-list device-list--rows">
                {pendingDevices.map((device) => (
                  <PendingDeviceRow
                    key={device.id}
                    device={device}
                    onOpen={() => openCameraSettings(device.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
        {page === 'cameras' &&
          (selectedDeviceId ? (
            <section className="card wide workspace-medium">
              <CameraSettings
                cameras={cameras.filter(
                  (camera) => camera.deviceId === selectedDeviceId,
                )}
                device={devices.find(
                  (device) => device.id === selectedDeviceId,
                )}
                onBack={() => {
                  const returnCamera = settingsReturnCameraId
                    ? cameras.find(
                        (camera) => camera.id === settingsReturnCameraId,
                      )
                    : undefined;
                  setSettingsReturnCameraId(null);
                  setSelectedDeviceId(null);
                  if (returnCamera) {
                    openCamera(returnCamera);
                    return;
                  }
                  window.history.pushState({}, '', '/cameras');
                }}
                onLive={openCamera}
                onRename={(device, name) => void renameDevice(device, name)}
                onDelete={(device) => requestDeleteDevice(device)}
                onCameraRename={(camera, name) =>
                  void renameCamera(camera, name)
                }
                onCameraDelete={(camera) => requestDeleteCamera(camera)}
                onPrivacy={(device) => void setPrivacy(device)}
                onSwitchSource={(camera) => void switchSource(camera)}
              />
            </section>
          ) : (
            <section
              className="camera-catalog wide workspace-wide"
              aria-label="Your cameras"
            >
              {pendingDevices.length > 0 && (
                <ul className="device-list device-list--rows">
                  {pendingDevices.map((device) => (
                    <PendingDeviceRow
                      key={device.id}
                      device={device}
                      onOpen={() => openCameraSettings(device.id)}
                    />
                  ))}
                </ul>
              )}
              <CameraBrowser cameras={hostCameras} key={user.id}>
                {(items) =>
                  items.length === 0 && pendingDevices.length === 0 ? (
                    <p className="empty">No cameras yet.</p>
                  ) : (
                    <div className="camera-tile-grid">
                      {items.map((camera) => (
                        <CameraTile
                          key={camera.deviceId}
                          camera={camera}
                          groupedByHost
                          highlighted={highlightedCameraId === camera.id}
                          onOpen={openCamera}
                          onDevice={openCameraSettings}
                          onRename={(item, name) =>
                            renameHostCamera(item, name)
                          }
                          onDelete={(item) => requestDeleteHostCamera(item)}
                        />
                      ))}
                    </div>
                  )
                }
              </CameraBrowser>
            </section>
          ))}
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
            onAddCamera={() => navigate('camera mode')}
          />
        )}
        {page === 'diagnostics' && <Diagnostics />}
        {page === 'settings' && (
          <div className="settings-layout wide">
            <section
              className="settings-section"
              aria-labelledby="account-section-title"
            >
              <h3 id="account-section-title">Account</h3>
              <div className="settings-row settings-row-identity">
                <div className="settings-identity">
                  <Avatar
                    email={user.email}
                    avatarUrl={user.avatarUrl}
                    size="lg"
                  />
                  <div>
                    <strong>{user.email}</strong>
                    <p>This session</p>
                  </div>
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
              <AccessHistory currentEmail={user.email} />
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
                    Permanently deletes your Beacon household, paired devices,
                    settings, and motion history. You&rsquo;ll be asked to
                    confirm before deletion.
                  </p>
                </div>
                <button
                  className="danger"
                  onClick={() => requestDeleteAccount()}
                >
                  Delete account
                </button>
              </div>
            </section>
          </div>
        )}
        {page === 'camera mode' && (
          <section className="card wide workspace-medium">
            <h3>Choose a device</h3>
            <div className="setup-options">
              <article>
                <span className="setup-icon">
                  <Icon name="phone" />
                </span>
                <h4>Android phone or tablet</h4>
                <p>Best for always-on use.</p>
                <button onClick={openPairing}>
                  Pair Android
                  <Icon name="arrow" />
                </button>
              </article>
              <article>
                <span className="setup-icon">
                  <Icon name="browser" />
                </span>
                <h4>This browser</h4>
                <p>Best for temporary use.</p>
                <button
                  className="secondary"
                  onClick={() => setBrowserCameraActive(true)}
                >
                  Use this browser
                </button>
              </article>
            </div>
            <p className="notice">
              Pair only a device you own or are authorized to use.
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
      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          description={pendingConfirm.description}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={pendingConfirm.onConfirm}
          onCancel={() => setPendingConfirm(null)}
        />
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

function PublicTrustPage({
  returnHref = '/',
  returnLabel = 'Return to Beacon',
}: {
  returnHref?: string;
  returnLabel?: string;
}) {
  return (
    <main className="shell trust-shell">
      <section className="trust-page" aria-labelledby="trust-title">
        <a className="trust-brand" href="/" aria-label="Beacon home">
          <Brand />
        </a>
        <p className="eyebrow">Trust and privacy</p>
        <h1 id="trust-title">Your camera stays under your control.</h1>
        <dl className="trust-facts">
          <div>
            <dt>Live only</dt>
            <dd>Video and audio are not stored.</dd>
          </div>
          <div>
            <dt>Visible capture</dt>
            <dd>The camera device shows when capture is active.</dd>
          </div>
          <div>
            <dt>Separate controls</dt>
            <dd>Viewing, listening, and talking each need their own action.</dd>
          </div>
        </dl>

        <div className="trust-keep">
          <div>
            <h2>What Beacon keeps</h2>
            <p>
              Account and camera settings, camera names, and motion-event
              metadata for your chosen retention period.
            </p>
          </div>
          <div>
            <h2>What Beacon never keeps</h2>
            <p>Video, audio, thumbnails, or facial identities.</p>
          </div>
        </div>

        <a className="secondary button-link trust-return" href={returnHref}>
          {returnLabel}
        </a>

        <p className="trust-alpha-note">
          Beacon is a private alpha. Formal terms are still coming. For privacy
          or deletion questions, use the <a href="/contact">contact form</a>. Do
          not rely on Beacon for emergency response or life-safety monitoring.
        </p>
      </section>
    </main>
  );
}

function CameraSettings({
  cameras,
  device,
  onBack,
  onLive,
  onDelete,
  onPrivacy,
  onRename,
  onCameraRename,
  onCameraDelete,
  onSwitchSource,
}: {
  cameras: Camera[];
  device: Device | undefined;
  onBack: () => void;
  onLive: (camera: Camera) => void;
  onDelete: (device: Device) => void;
  onPrivacy: (device: Device) => void;
  onRename: (device: Device, name: string) => void;
  onCameraRename: (camera: Camera, name: string) => void;
  onCameraDelete: (camera: Camera) => void;
  onSwitchSource: (camera: Camera) => void;
}) {
  const [renamingDevice, setRenamingDevice] = useState(false);
  if (!device) {
    return (
      <>
        <h3>Camera not found</h3>
        <p>This camera is unavailable or does not belong to your household.</p>
        <button onClick={onBack}>Back to Cameras</button>
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
        ? 'Pairing disabled'
        : device.online
          ? 'Online'
          : 'Offline';
  const batteryLabel =
    device.platform !== 'android'
      ? 'Not applicable'
      : device.batteryPercent === null || device.batteryPercent === undefined
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
          <p className="eyebrow">{deviceKindLabel(device)}</p>
          {renamingDevice ? (
            <InlineRename
              value={device.name}
              ariaLabel="Rename this camera"
              className="inline-rename-heading"
              onSubmit={(name) => {
                setRenamingDevice(false);
                onRename(device, name);
              }}
              onCancel={() => setRenamingDevice(false)}
            />
          ) : (
            <div className="heading-with-rename">
              <h3>{device.name}</h3>
              <button
                type="button"
                className="rename-affordance"
                aria-label="Rename this camera"
                onClick={() => setRenamingDevice(true)}
              >
                <Icon name="edit" />
              </button>
            </div>
          )}
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
              Applies to every camera on this phone. Local privacy is the
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
      {cameras.length === 0 ? (
        <>
          <h4>Camera</h4>
          <p className="empty">No camera paired to this device yet.</p>
        </>
      ) : (
        <>
          <div className="section-heading">
            <h4>{cameras.length > 1 ? 'Sources' : 'Camera'}</h4>
            {cameras.length > 1 && (
              <CameraFlipButton
                sources={cameras}
                activeId={
                  (
                    cameras.find((camera) => camera.streaming) ??
                    cameras.find((camera) => camera.online) ??
                    cameras[0]!
                  ).id
                }
                onSwitch={(id) => {
                  const target = cameras.find((camera) => camera.id === id);
                  if (target) onSwitchSource(target);
                }}
              />
            )}
          </div>
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
        </>
      )}
      <details className="device-settings">
        <summary>Advanced</summary>
        <div className="device-settings-content">
          <p>Capabilities: {capabilitySummary(device.capabilities)}</p>
          <p>
            Software version: {device.softwareVersion ?? 'not reported'}
            {' · '}Access:{' '}
            {device.revoked
              ? 'Revoked'
              : device.enabled
                ? 'Active'
                : 'Disabled'}
          </p>
          <div className="heading-actions">
            <button className="danger" onClick={() => onDelete(device)}>
              Remove camera
            </button>
          </div>
          <p className="notice">
            Removing this camera disconnects every source paired to it. You can
            pair the device again later.
          </p>
        </div>
      </details>
      {device.platform === 'android' && !device.revoked && (
        <MotionSettingsPanel deviceId={device.id} cameras={cameras} />
      )}
    </>
  );
}

/** A paired device that hasn't reported a usable camera yet (mid-setup, or
 * temporarily offline before it ever registered one) still needs to be
 * visible and reachable — it just doesn't have a camera tile to show yet. */
function PendingDeviceRow({
  device,
  onOpen,
}: {
  device: Device;
  onOpen: () => void;
}) {
  const guidance = deviceGuidance({
    cameraCount: 0,
    enabled: device.enabled,
    online: device.online,
    platform: device.platform,
    privacyMode: device.privacyMode,
    revoked: device.revoked,
  });
  return (
    <li>
      <div>
        <strong>{device.name}</strong>
        <span>{guidance.title}</span>
      </div>
      <button className="secondary" onClick={onOpen}>
        Open
      </button>
    </li>
  );
}

function AccessHistory({ currentEmail }: { currentEmail: string }) {
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
        household. An entry with no account shown was your account. Network
        addresses and connection details are not shown.
      </p>
      {error && <p role="alert">{error}</p>}
      {events === null && !error && (
        <p role="status">Loading access history…</p>
      )}
      {events?.length === 0 && <p className="empty">No camera access yet.</p>}
      {events && events.length > 0 && (
        <ul className="access-list">
          {groupAccessEvents(events).map(({ key, latest, attempts }) => (
            <li key={key}>
              <div>
                <strong>
                  {latest.success ? 'Live view started' : 'Access rejected'}
                  {attempts > 1 &&
                    ` (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'})`}
                </strong>
                <span>{latest.deviceName ?? 'Unknown camera device'}</span>
                {!latest.success && (
                  <span>{rejectionReasonLabel(latest.reason)}</span>
                )}
              </div>
              {latest.actorEmail && latest.actorEmail !== currentEmail && (
                <span>{latest.actorEmail}</span>
              )}
              <span>{new Date(latest.occurredAt).toLocaleString()}</span>
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
