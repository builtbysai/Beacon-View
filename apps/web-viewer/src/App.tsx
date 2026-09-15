import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, request } from './api';
import { nextPairingState } from './lifecycle';
import { cameraStatus } from './camera-status';
import type { PairingLifecycle } from './lifecycle';
import { LiveVideo } from './LiveVideo';
import { LiveCameraSettingsDialog } from './LiveCameraSettingsDialog';
import { CameraTile } from './CameraTile';
import { CameraSettings } from './CameraSettings';
import { ConfirmDialog } from './ConfirmDialog';
import { BrowserCameraMode } from './BrowserCameraMode';
import { MotionEventList } from './MotionEventList';
import { AuthScreen } from './AuthScreen';
import { SplashScreen } from './SplashScreen';
import { CameraBrowser } from './CameraBrowser';
import { ContactPage } from './ContactPage';
import { Diagnostics } from './Diagnostics';
import { GuestViewPage } from './GuestViewPage';
import { Brand, Icon } from './Icon';
import { Sidebar } from './Sidebar';
import { PendingDeviceRow } from './PendingDeviceRow';
import { AddCameraPage } from './AddCameraPage';
import { PairingDialog } from './PairingDialog';
import { SettingsPage } from './SettingsPage';
import {
  MobileAuthReturnPage,
  PairLinkPage,
  PublicTrustPage,
} from './PublicPages';
import { ResetPasswordPage } from './ResetPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { groupCamerasByDevice, reconcileLiveCamera } from './camera-selection';
import type { Camera, Device, HouseholdSession, User } from './domain';
import {
  contentWidthClass,
  deviceSettingsIdFromPath,
  legacyDeviceIdFromPath,
  navigationIcons,
  pageFromPath,
  pageLabels,
  pagePaths,
  pagesWithAddCamera,
  type Page,
} from './app-navigation';
import {
  useHouseholdEvents,
  type HouseholdEvent,
} from './use-household-events';
import { disableWebNotifications } from './NotificationSettings';

const SPLASH_SEEN_KEY = 'beacon.splash.seen.v1';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<HouseholdSession | null>(null);
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
  const [liveSettingsOpen, setLiveSettingsOpen] = useState(false);
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
  const [activityNotice, setActivityNotice] = useState('');
  const [motionEventRevision, setMotionEventRevision] = useState(0);
  const [motionClearRevision, setMotionClearRevision] = useState(0);
  const [membershipRevision, setMembershipRevision] = useState(0);
  const [driveRecordingReady, setDriveRecordingReady] = useState(false);
  const returnPage = useRef<Page>('cameras');
  const reconnectDeviceId = useRef<string | null>(null);
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

  const navigate = useCallback((next: Page, search?: string) => {
    window.history.pushState({}, '', `${pagePaths[next]}${search ?? ''}`);
    setPage(next);
    setSelectedDeviceId(null);
    setSelectedCamera(null);
    setLiveSettingsOpen(false);
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
    setHousehold(null);
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
      setSelectedCamera((current) => {
        const routeCamera = cameraResult.cameras.find(
          (camera) => camera.id === decodeURIComponent(cameraMatch[1]!),
        );
        const next = current
          ? reconcileLiveCamera(current, cameraResult.cameras)
          : (routeCamera ?? null);
        if (next && next.id !== decodeURIComponent(cameraMatch[1]!)) {
          window.history.replaceState(
            {},
            '',
            `/cameras/${encodeURIComponent(next.id)}`,
          );
        }
        return next;
      });
    }
    return cameraResult.cameras;
  }, []);

  // A household invitation link (/join?token=...) can be opened signed out,
  // so it can't accept on the spot the way pasting a code into Settings
  // does. Stash the token and fall through to the normal sign-in/register
  // flow below; a separate effect applies it once a session exists, whether
  // that's immediately (already signed in) or after registering.
  useEffect(() => {
    if (window.location.pathname !== '/join') return;
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      try {
        window.sessionStorage.setItem('beacon_pending_invite', token);
      } catch {
        /* Invitation still works by pasting the code manually. */
      }
    }
    window.history.replaceState({}, '', '/');
  }, []);

  useEffect(() => {
    if (
      window.location.pathname === '/trust' ||
      window.location.pathname === '/pair' ||
      window.location.pathname === '/auth/mobile' ||
      window.location.pathname === '/account/verify-email' ||
      window.location.pathname === '/account/reset-password' ||
      window.location.pathname.startsWith('/g/')
    )
      return;
    void request<{ household: HouseholdSession; user: User }>('/api/auth/me')
      .then(async (result) => {
        await loadCameras();
        setUser(result.user);
        setHousehold(result.household ?? { id: '', role: 'owner' });
      })
      .catch(() => {
        setUser(null);
        setHousehold(null);
      })
      .finally(() => setLoading(false));
  }, [loadCameras]);

  // Account state (email verification, Google/Drive links, household role)
  // can change in another tab -- the verify-email and OAuth-callback pages
  // are typically opened from an email link or popup, not this tab. Refetch
  // whenever the user returns to this tab instead of leaving it stale until
  // a manual reload.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    function resync() {
      if (document.visibilityState !== 'visible') return;
      void request<{ household: HouseholdSession; user: User }>('/api/auth/me')
        .then((result) => {
          if (cancelled) return;
          setUser(result.user);
          setHousehold(result.household ?? { id: '', role: 'owner' });
        })
        .catch(() => {
          /* Transient failure; the next focus or poll resyncs. */
        });
    }
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
    };
  }, [user !== null]);

  // Only the household owner can request recordings, and only the live
  // viewer (where the record control actually appears) needs to know
  // whether Drive is ready to accept one -- fetched just for that view
  // rather than globally, so it drives whether LiveVideo shows a working
  // record button or a way to connect Drive instead of a dead-end error
  // after tapping record.
  useEffect(() => {
    if (!selectedCamera || household?.role !== 'owner') {
      setDriveRecordingReady(false);
      return;
    }
    let cancelled = false;
    void request<{ recordingsConnected: boolean }>('/api/drive/status')
      .then((result) => {
        if (!cancelled) setDriveRecordingReady(result.recordingsConnected);
      })
      .catch(() => {
        if (!cancelled) setDriveRecordingReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCamera, household?.role]);

  // Applies a /join link's stashed token once a session exists -- either
  // immediately (already signed in) or right after this same load's sign-in/
  // register completes, since authenticate() below also triggers a re-render
  // with a non-null user.
  useEffect(() => {
    if (!user) return;
    let token: string | null;
    try {
      token = window.sessionStorage.getItem('beacon_pending_invite');
    } catch {
      return;
    }
    if (!token) return;
    try {
      window.sessionStorage.removeItem('beacon_pending_invite');
    } catch {
      /* Not essential; a stale entry just gets overwritten by the next join link. */
    }
    void request<{ householdId: string }>('/api/household/invitations/accept', {
      body: JSON.stringify({ token }),
      method: 'POST',
    })
      .then((accepted) =>
        request('/api/account/household', {
          body: JSON.stringify({ householdId: accepted.householdId }),
          method: 'PUT',
        }),
      )
      .then(() =>
        request<{ household: HouseholdSession; user: User }>('/api/auth/me'),
      )
      .then(async (result) => {
        await loadCameras();
        setUser(result.user);
        setHousehold(result.household ?? { id: '', role: 'owner' });
        setActivityNotice('You joined the household.');
        window.setTimeout(() => setActivityNotice(''), 6_000);
      })
      .catch((caught) => {
        setActivityNotice(
          caught instanceof ApiError
            ? caught.message
            : 'That invitation could not be accepted.',
        );
        window.setTimeout(() => setActivityNotice(''), 6_000);
      });
  }, [user, loadCameras]);

  const handleHouseholdEvent = useCallback(
    (message: HouseholdEvent) => {
      if (
        message.type === 'camera-paired' ||
        message.type === 'camera-presence-changed' ||
        message.type === 'device-credential-revoked' ||
        message.type === 'device-management-changed'
      ) {
        void loadCameras().then(() => {
          if (message.type === 'camera-paired' && message.cameraId) {
            setActivityNotice('A new camera is connected and ready to use.');
            window.setTimeout(() => setActivityNotice(''), 6_000);
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
        if (message.type === 'motion-history-cleared') {
          setMotionClearRevision((revision) => revision + 1);
        }
      }
      if (message.type === 'household-membership-changed') {
        setMembershipRevision((revision) => revision + 1);
      }
    },
    [loadCameras, navigate],
  );
  const handleSessionEnded = useCallback(
    () => clearLocalSession('You were signed out because this session ended.'),
    [clearLocalSession],
  );
  const handleRefreshNeeded = useCallback(() => {
    void loadCameras();
    void request<{ household: HouseholdSession; user: User }>('/api/auth/me')
      .then((result) => {
        setUser(result.user);
        setHousehold(result.household ?? { id: '', role: 'owner' });
      })
      .catch(() => undefined);
  }, [loadCameras]);
  useHouseholdEvents({
    enabled:
      user !== null &&
      (household?.role === 'owner' || household?.role === 'admin'),
    onEvent: handleHouseholdEvent,
    onRefreshNeeded: handleRefreshNeeded,
    onSessionEnded: handleSessionEnded,
  });

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const login = await request<{ googleLinked?: boolean; user: User }>(
        `/api/auth/${mode}`,
        {
          body: JSON.stringify({
            email: form.get('email'),
            password: form.get('password'),
          }),
          method: 'POST',
        },
      );
      const result = await request<{
        household: HouseholdSession;
        user: User;
      }>('/api/auth/me');
      await loadCameras();
      setUser(result.user);
      setHousehold(result.household ?? { id: '', role: 'owner' });
      if (login.googleLinked) {
        setActivityNotice(
          'Signed in and linked your Google account -- sign in with either method from now on.',
        );
        window.setTimeout(() => setActivityNotice(''), 6_000);
      }
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message === 'googleAccountExists'
          ? "This email already has a Google account. Use “Continue with Google” above, then add a password from Settings once you're signed in."
          : caught instanceof Error
            ? caught.message
            : 'Request failed',
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    try {
      await disableWebNotifications().catch(() => undefined);
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      clearLocalSession();
    }
    setPairingOpen(false);
  }

  function openPairing(deviceId?: string) {
    returnPage.current = page;
    reconnectDeviceId.current = deviceId ?? null;
    setPairingState('pending');
    setPairingCode('');
    setPairingOpen(true);
    void createPairingCode();
  }

  function cameraNeedsPairing(camera: Camera): boolean {
    const device = devices.find(
      (candidate) => candidate.id === camera.deviceId,
    );
    return Boolean(
      device &&
      device.platform === 'android' &&
      (device.revoked || !device.online),
    );
  }

  async function createPairingCode() {
    setError('');
    setPairingBusy(true);
    try {
      const path = reconnectDeviceId.current
        ? `/api/devices/${encodeURIComponent(reconnectDeviceId.current)}/pairing-code`
        : '/api/pairing-codes';
      const result = await request<{ code: string }>(path, {
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
    reconnectDeviceId.current = null;
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

  async function leaveCamera(camera: Camera) {
    try {
      setError('');
      await request(`/api/account/cameras/${camera.id}`, { method: 'DELETE' });
      await loadCameras();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'This camera could not be removed from your view.',
      );
    }
  }

  function requestLeaveCamera(camera: Camera) {
    setPendingConfirm({
      title: `Leave ${camera.name}?`,
      description:
        'You will stop seeing this camera. It stays paired and visible to the rest of the household.',
      confirmLabel: 'Leave camera',
      onConfirm: () => {
        setPendingConfirm(null);
        void leaveCamera(camera);
      },
    });
  }

  /** A grid tile represents the whole host device, so leaving it leaves
   * every source on that device the viewer currently has access to, not
   * just whichever one happens to be active. */
  function requestLeaveHostCamera(camera: Camera) {
    const siblings = cameras.filter(
      (item) => item.deviceId === camera.deviceId && item.canLeave,
    );
    setPendingConfirm({
      title: `Leave ${camera.deviceName}?`,
      description:
        'You will stop seeing this camera. It stays paired and visible to the rest of the household.',
      confirmLabel: 'Leave camera',
      onConfirm: () => {
        setPendingConfirm(null);
        void Promise.all(siblings.map((item) => leaveCamera(item)));
      },
    });
  }

  function requestDeleteAccount() {
    setPendingConfirm({
      title: 'Sorry to see you go',
      description:
        'Deleting your account permanently removes your Beacon household, paired cameras, settings, motion history, and camera activity. Live connections stop immediately. Encrypted backup copies expire on their normal schedule.',
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
      await disableWebNotifications().catch(() => undefined);
      setPairingOpen(false);
      clearLocalSession();
      window.history.pushState({}, '', '/');
      setPage('dashboard');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setPendingConfirm({
          title: 'Confirm it’s you',
          description:
            'For security, account deletion requires a recent sign-in. Sign out, sign back in, then choose Delete account again.',
          confirmLabel: 'Sign out',
          onConfirm: () => {
            setPendingConfirm(null);
            void logout();
          },
        });
        return;
      }
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

  if (window.location.pathname.startsWith('/g/')) return <GuestViewPage />;
  if (window.location.pathname === '/pair') return <PairLinkPage />;
  if (window.location.pathname === '/auth/mobile')
    return <MobileAuthReturnPage />;
  if (window.location.pathname === '/account/verify-email')
    return <VerifyEmailPage />;
  if (window.location.pathname === '/account/reset-password')
    return <ResetPasswordPage />;
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
          onDevice={() => setLiveSettingsOpen(true)}
          canRecord={household?.role === 'owner'}
          recordingReady={driveRecordingReady}
          onConnectDriveForRecording={() =>
            navigate('settings', '?section=storage')
          }
          canFlip={selectedCamera.canFlip ?? true}
          canPause={selectedCamera.canPause ?? true}
        />
        {liveSettingsOpen && liveDevice && (
          <LiveCameraSettingsDialog
            camera={selectedCamera}
            device={liveDevice}
            sources={siblings}
            onDismiss={() => setLiveSettingsOpen(false)}
            onPrivacy={() => setPrivacy(liveDevice)}
            onRename={(name) => renameHostCamera(selectedCamera, name)}
            onSwitch={(camera) => switchSource(camera)}
          />
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
        {activityNotice && (
          <p className="activity-toast" role="status">
            <Icon name="camera" />
            {activityNotice}
          </p>
        )}
        {page === 'dashboard' &&
          cameras.length === 0 &&
          (household?.role === 'owner' || household?.role === 'admin' ? (
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
              </div>
            </section>
          ) : (
            <section className="home-dashboard home-dashboard-empty workspace-wide">
              <h1 className="home-title" ref={pageHeading} tabIndex={-1}>
                No cameras shared with you yet
              </h1>
              <p>
                Ask the household owner or an admin to grant you access to a
                camera from Settings → Household sharing.
              </p>
            </section>
          ))}
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
                  {...(cameraNeedsPairing(camera)
                    ? {
                        onReconnect: (item: Camera) =>
                          openPairing(item.deviceId),
                      }
                    : {})}
                  onRename={(item, name) => renameHostCamera(item, name)}
                  onDelete={(item) => requestDeleteHostCamera(item)}
                  onLeave={(item) => requestLeaveHostCamera(item)}
                />
              ))}
            </div>
            {pendingDevices.length > 0 && (
              <ul className="pending-device-list">
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
                onLeave={(device) =>
                  requestLeaveHostCamera(
                    cameras.find((camera) => camera.deviceId === device.id)!,
                  )
                }
                onCameraRename={(camera, name) =>
                  void renameCamera(camera, name)
                }
                onCameraDelete={(camera) => requestDeleteCamera(camera)}
                onCameraLeave={(camera) => requestLeaveCamera(camera)}
                onPrivacy={(device) => void setPrivacy(device)}
                onSwitchSource={(camera) => void switchSource(camera)}
                onReconnect={(device) => openPairing(device.id)}
              />
            </section>
          ) : (
            <section
              className="camera-catalog wide workspace-wide"
              aria-label="Your cameras"
            >
              {pendingDevices.length > 0 && (
                <ul className="pending-device-list">
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
                          {...(cameraNeedsPairing(camera)
                            ? {
                                onReconnect: (item: Camera) =>
                                  openPairing(item.deviceId),
                              }
                            : {})}
                          onRename={(item, name) =>
                            renameHostCamera(item, name)
                          }
                          onDelete={(item) => requestDeleteHostCamera(item)}
                          onLeave={(item) => requestLeaveHostCamera(item)}
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
          <SettingsPage
            cameras={cameras}
            user={user}
            household={household!}
            membershipRevision={membershipRevision}
            onLogout={() => void logout()}
            onDeleteAccount={requestDeleteAccount}
            onCurrentSessionRevoked={clearLocalSession}
            onUserChanged={() => {
              void request<{ household: HouseholdSession; user: User }>(
                '/api/auth/me',
              )
                .then((result) => {
                  setUser(result.user);
                  setHousehold(result.household ?? { id: '', role: 'owner' });
                })
                .catch(() => undefined);
            }}
          />
        )}
        {page === 'camera mode' && (
          <AddCameraPage
            onPairAndroid={() => openPairing()}
            onUseBrowser={() => setBrowserCameraActive(true)}
          />
        )}
      </main>
      {pairingOpen && (
        <PairingDialog
          busy={pairingBusy}
          code={pairingCode}
          error={error}
          state={pairingState}
          reconnecting={reconnectDeviceId.current !== null}
          onCopyError={() => setError('Could not copy the setup link.')}
          onDismiss={cancelPairing}
          onRetry={() => void createPairingCode()}
        />
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
