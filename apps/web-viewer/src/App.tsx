import './App.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, request, SESSION_ENDED_EVENT } from './api';
import { friendlyError } from './friendly-errors';
import { alertDestination, resolveAlert, takeAlertId } from './alert-link';
import { useDriveRecording } from './drive-recording';
import { CameraWall } from './CameraWall';
import { wallStorageKey } from './wall-layouts';
import { LivePlayerProvider, LivePlayerSlot } from './LivePlayerHost';
import { ErrorNotice } from './ErrorNotice';
import { nextPairingState } from './lifecycle';
import { cameraStatus } from './camera-status';
import type { PairingLifecycle } from './lifecycle';
import { CameraTile } from './CameraTile';
import { CameraSettings } from './CameraSettings';
import { ModalDialog } from './ModalDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { ReauthenticationDialog } from './ReauthenticationDialog';
import { BrowserCameraMode } from './BrowserCameraMode';
import { MotionEventList } from './MotionEventList';
import { RecordingLibrary } from './RecordingLibrary';
import { EventsViewSwitch, type EventsView } from './EventsViewSwitch';
import { AuthScreen } from './AuthScreen';
import { SplashScreen } from './SplashScreen';
import { CameraBrowser } from './CameraBrowser';
import { ContactPage } from './ContactPage';
import { Diagnostics } from './Diagnostics';
import { GuestViewPage } from './GuestViewPage';
import { SharedRecordingPage } from './SharedRecordingPage';
import { Brand, Icon } from './Icon';
import { Sidebar, SidebarProvider, SidebarTrigger } from './Sidebar';
import { PendingDeviceRow } from './PendingDeviceRow';
import { AddCameraPage } from './AddCameraPage';
import { ComputerCameraSetupDialog } from './ComputerCameraSetupDialog';
import { takePendingUseCase } from './pending-use-case';
import { type DesktopAlert, desktopBridge } from './desktop-shell';
import { PairingDialog } from './PairingDialog';
import { SettingsPage } from './SettingsPage';
import { HouseholdModeBar } from './HouseholdModeSettings';
import { announceModeChange } from './household-mode';
import { reportTrayCameras, trayCameras } from './desktop-tray';
import {
  DesktopAuthReturnPage,
  MobileAuthReturnPage,
  PairLinkPage,
  PublicTrustPage,
} from './PublicPages';
import { ResetPasswordPage } from './ResetPasswordPage';
import { VerifyEmailPage } from './VerifyEmailPage';
import { groupCamerasByDevice, reconcileLiveCamera } from './camera-selection';
import type { Camera, Device, HouseholdSession, User } from './domain';
import { goBack, pushRoute, replaceRoute } from './history-nav';
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
import { FavoriteCameraCard } from './FavoriteCameraCard';
import { FavoritesEditor } from './FavoritesEditor';
import { LatestActivityPreview } from './LatestActivityPreview';
import { loadFavoriteDeviceIds, saveFavoriteDeviceIds } from './favorites';
import {
  isBackendCapabilities,
  type BackendCapabilities,
} from './capabilities';
import { isLocalBrowserCamera } from './browser-camera-local';

const SPLASH_SEEN_KEY = 'beacon.splash.seen.v1';

/** The app, with the live player hosted above its pages so a floating
 * picture-in-picture window can outlive the live page (ADR 0091). */
export function App() {
  return (
    <LivePlayerProvider>
      <AppShell />
    </LivePlayerProvider>
  );
}

function AppShell() {
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
  // Beacon couldn't be reached while opening (not the same as signed out).
  const [startupError, setStartupError] = useState('');
  // The camera list failed to load: say so (with Retry) instead of showing
  // "Add your first device" as if there were none.
  const [camerasError, setCamerasError] = useState('');
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [pendingConfirmBusy, setPendingConfirmBusy] = useState(false);
  const [reauthenticationOpen, setReauthenticationOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const [page, setPage] = useState<Page>(pageFromPath);
  // Which Settings tab is showing, mirrored in the URL (?section=...) so
  // browser back/forward steps through them and a link into a specific
  // section (e.g. "Connect Drive" from the live view) always lands there.
  const [settingsSection, setSettingsSection] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('section'),
  );
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingState, setPairingState] = useState<PairingLifecycle>('pending');
  const [browserCameraActive, setBrowserCameraActive] = useState(false);
  const [computerSetupOpen, setComputerSetupOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    deviceSettingsIdFromPath,
  );
  const [highlightedCameraId, setHighlightedCameraId] = useState<string | null>(
    null,
  );
  const [activityNotice, setActivityNotice] = useState('');
  const [motionEventRevision, setMotionEventRevision] = useState(0);
  const [motionClearRevision, setMotionClearRevision] = useState(0);
  const [eventsView, setEventsView] = useState<EventsView>('activity');
  const [focusRecordingId, setFocusRecordingId] = useState<string | null>(null);
  const [focusMotionEventId, setFocusMotionEventId] = useState<string | null>(
    null,
  );
  const [membershipRevision, setMembershipRevision] = useState(0);
  const [capabilities, setCapabilities] = useState<BackendCapabilities | null>(
    null,
  );
  // `null` means "no saved preference yet" -- Home falls back to a default
  // selection rather than showing zero favorites. See favorites.ts.
  const [favoriteDeviceIds, setFavoriteDeviceIds] = useState<string[] | null>(
    null,
  );
  const [favoritesEditorOpen, setFavoritesEditorOpen] = useState(false);
  const returnPage = useRef<Page>('cameras');
  const reconnectDeviceId = useRef<string | null>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const priorPage = useRef(page);

  useEffect(() => {
    document.title = `${pageLabels[page]} · Beacon`;
    if (priorPage.current !== page) pageHeading.current?.focus();
    priorPage.current = page;
  }, [page]);

  useEffect(() => {
    if (household) setFavoriteDeviceIds(loadFavoriteDeviceIds(household.id));
  }, [household]);

  // Devices was removed as a user-facing destination; redirect a bookmarked
  // or shared /devices/:id link to its camera-centric equivalent instead of
  // breaking it.
  useEffect(() => {
    const legacyId = legacyDeviceIdFromPath();
    if (legacyId) {
      replaceRoute(`/cameras/${encodeURIComponent(legacyId)}/settings`);
    }
  }, []);

  const navigate = useCallback((next: Page, search?: string) => {
    pushRoute(`${pagePaths[next]}${search ?? ''}`);
    setError('');
    setPage(next);
    setSelectedDeviceId(null);
    setSelectedCamera(null);
    setBrowserCameraActive(false);
    setSettingsSection(new URLSearchParams(search).get('section'));
    if (next === 'events') setEventsView('activity');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setError('');
      const settingsId = deviceSettingsIdFromPath();
      const overlayState = window.history.state as {
        cameraSettingsBackgroundPage?: Page;
        cameraSettingsBackgroundCameraId?: string;
      } | null;
      setPage(
        settingsId
          ? (overlayState?.cameraSettingsBackgroundPage ?? 'cameras')
          : pageFromPath(),
      );
      const cameraMatch =
        window.location.pathname.match(/^\/cameras\/([^/]+)$/);
      setSelectedDeviceId(settingsId);
      const cameraId = settingsId
        ? overlayState?.cameraSettingsBackgroundCameraId
        : cameraMatch
          ? decodeURIComponent(cameraMatch[1]!)
          : null;
      setSelectedCamera(
        cameraId
          ? (cameras.find((camera) => camera.id === cameraId) ?? null)
          : null,
      );
      setSettingsSection(
        new URLSearchParams(window.location.search).get('section'),
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

  const signedIn = user !== null;
  // The desktop tray lists the favorite cameras as shortcuts (ADR 0095).
  useEffect(() => {
    reportTrayCameras(
      signedIn
        ? trayCameras(groupCamerasByDevice(cameras), favoriteDeviceIds)
        : [],
    );
  }, [cameras, favoriteDeviceIds, signedIn]);
  useEffect(() => {
    if (!signedIn) return;
    const ended = () =>
      clearLocalSession('Your session ended. Sign in again to continue.');
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, [clearLocalSession, signedIn]);

  const loadCameras = useCallback(async () => {
    const [cameraResult, deviceResult] = await Promise.all([
      request<{ cameras: Camera[] }>('/api/cameras'),
      request<{ devices: Device[] }>('/api/devices'),
    ]);
    setCameras(cameraResult.cameras);
    setDevices(deviceResult.devices);
    setCamerasError('');
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
          replaceRoute(`/cameras/${encodeURIComponent(next.id)}`);
        }
        return next;
      });
    }
    return cameraResult.cameras;
  }, []);

  // Tapping an alert (ADR 0090) opens the camera it was about, or Activity
  // when there is none. Waits for sign-in, so signing in first still works.
  const alertHandled = useRef(false);
  useEffect(() => {
    if (!user || alertHandled.current) return;
    alertHandled.current = true;
    const eventId = takeAlertId();
    if (!eventId) return;
    void (async () => {
      const target = await resolveAlert(eventId);
      const list = await loadCameras().catch(() => [] as Camera[]);
      const destination = alertDestination(
        target,
        list.map((camera) => camera.id),
      );
      if (destination === 'activity') {
        navigate('events');
        return;
      }
      const camera = list.find((item) => item.id === destination.cameraId);
      if (camera) openCamera(camera);
    })();
    // openCamera and navigate only touch state setters and history.
  }, [user]);

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
    replaceRoute('/');
  }, []);

  useEffect(() => {
    if (
      window.location.pathname === '/trust' ||
      window.location.pathname === '/pair' ||
      window.location.pathname === '/auth/mobile' ||
      window.location.pathname === '/auth/desktop/complete' ||
      window.location.pathname === '/account/verify-email' ||
      window.location.pathname === '/account/reset-password' ||
      window.location.pathname.startsWith('/g/') ||
      window.location.pathname.startsWith('/shared/')
    )
      return;
    void request<{ household: HouseholdSession; user: User }>('/api/auth/me')
      .then(async (result) => {
        // Signed in: a camera list that fails to load is reported in the
        // workspace, never shown as being signed out.
        await loadCameras().then(
          () => setCamerasError(''),
          (caught: unknown) =>
            setCamerasError(
              `Your cameras couldn’t be loaded. ${friendlyError(caught, 'Try again.')}`,
            ),
        );
        setStartupError('');
        setUser(result.user);
        setHousehold(result.household ?? { id: '', role: 'owner' });
      })
      .catch((caught: unknown) => {
        setUser(null);
        setHousehold(null);
        // Only "not signed in" leads to the sign-in screen; an outage or a
        // dropped connection gets an explanation and a retry instead.
        if (!(caught instanceof ApiError && caught.status === 401))
          setStartupError(
            friendlyError(caught, 'Beacon couldn’t be opened. Try again.'),
          );
      })
      .finally(() => setLoading(false));
  }, [loadCameras, startupAttempt]);

  const retryCameras = useCallback(() => {
    void loadCameras().then(
      () => setCamerasError(''),
      (caught: unknown) =>
        setCamerasError(
          `Your cameras still couldn’t be loaded. ${friendlyError(caught, 'Try again.')}`,
        ),
    );
  }, [loadCameras]);

  const retryStartup = useCallback(() => {
    setStartupError('');
    setLoading(true);
    setStartupAttempt((attempt) => attempt + 1);
  }, []);

  // Coming back online retries a start that failed for lack of a network.
  useEffect(() => {
    if (!startupError) return;
    window.addEventListener('online', retryStartup);
    return () => window.removeEventListener('online', retryStartup);
  }, [retryStartup, startupError]);

  useEffect(() => {
    if (loading || capabilities || (user && page !== 'settings')) return;
    void request<unknown>('/api/capabilities')
      .then((result) => {
        if (isBackendCapabilities(result)) setCapabilities(result);
      })
      .catch(() => setCapabilities(null));
  }, [capabilities, loading, page, user]);

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

  // Only the household owner records. Drive readiness is tracked while a
  // record control can be on screen (a live view or Camera Mode), so it
  // shows a working record button, or "Connect/Reconnect Google Drive"
  // that fixes things in place -- never a dead-end error after recording.
  const drive = useDriveRecording(
    household?.role === 'owner' &&
      (selectedCamera !== null || browserCameraActive),
  );

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
          friendlyError(
            caught,
            'That invitation couldn’t be accepted. Ask for a new one.',
          ),
        );
        window.setTimeout(() => setActivityNotice(''), 6_000);
      });
  }, [user, loadCameras]);

  const handleHouseholdEvent = useCallback(
    (message: HouseholdEvent) => {
      if (message.type === 'notification') {
        // Only the desktop app subscribes to this channel; it validates the
        // alert again before showing an OS notification.
        desktopBridge()?.showAlert?.({
          category: message.category as DesktopAlert['category'],
          eventId: message.eventId ?? '',
          route: message.route as DesktopAlert['route'],
        });
        return;
      }
      if (
        message.type === 'camera-paired' ||
        message.type === 'camera-presence-changed' ||
        message.type === 'device-credential-revoked' ||
        message.type === 'device-management-changed'
      ) {
        // A computer set up from "Set up a computer" gets the use case the
        // owner picked there (ADR 0084).
        const pendingUseCase =
          message.type === 'camera-paired' && message.cameraId
            ? takePendingUseCase()
            : null;
        const applied =
          pendingUseCase && pendingUseCase !== 'general' && message.cameraId
            ? request(
                `/api/cameras/${encodeURIComponent(message.cameraId)}/use-case`,
                {
                  body: JSON.stringify({ useCase: pendingUseCase }),
                  method: 'PUT',
                },
              ).catch(() => undefined)
            : Promise.resolve();
        void applied
          .then(loadCameras)
          .then(() => {
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
          })
          .catch(() =>
            setError(
              'A camera changed, but the list couldn’t refresh. Reload to see it.',
            ),
          );
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
      if (
        message.type === 'camera-paired' ||
        message.type === 'device-credential-revoked' ||
        message.type === 'device-management-changed' ||
        message.type === 'household-membership-changed'
      ) {
        setMotionEventRevision((revision) => revision + 1);
      }
      if (message.type === 'household-mode-changed') announceModeChange();
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
    // A background refresh; the next event or focus refreshes again.
    void loadCameras().catch(() => undefined);
    setMotionEventRevision((revision) => revision + 1);
    setMembershipRevision((revision) => revision + 1);
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
        caught instanceof ApiError && caught.code === 'google_account_exists'
          ? "This email already has a Google account. Use “Continue with Google” above, then add a password from Settings once you're signed in."
          : friendlyError(
              caught,
              mode === 'login'
                ? 'Sign-in didn’t work. Try again.'
                : 'Your account couldn’t be created. Try again.',
            ),
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

  function cameraCanReconnect(camera: Camera): boolean {
    return (
      cameraNeedsPairing(camera) &&
      Boolean(
        devices.find((device) => device.id === camera.deviceId)?.canRemove,
      )
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
      setError(
        friendlyError(caught, 'A pairing code couldn’t be created. Try again.'),
      );
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
      setError(friendlyError(caught, 'The name couldn’t be saved. Try again.'));
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
      setError(friendlyError(caught, 'The name couldn’t be saved. Try again.'));
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
        friendlyError(caught, 'The camera couldn’t be switched. Try again.'),
      );
    }
  }

  function requestDeleteCamera(camera: Camera) {
    const warning =
      camera.viewerCount > 0
        ? ` ${camera.viewerCount} active viewer session(s) will be terminated.`
        : '';
    setPendingConfirm({
      title: `Remove ${camera.name}?`,
      description: `This removes the camera from Beacon and disconnects its pairing.${warning} To use this device again, you'll need to pair it again.`,
      confirmLabel: 'Remove camera',
      onConfirm: () => {
        void (async () => {
          setPendingConfirmBusy(true);
          try {
            await deleteCamera(camera);
          } finally {
            setPendingConfirmBusy(false);
            setPendingConfirm(null);
          }
        })();
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
        friendlyError(caught, 'The camera couldn’t be removed. Try again.'),
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
      title: `Remove ${device.name}?`,
      description: `This removes the camera from Beacon and disconnects its pairing.${warning} To use this device again, you'll need to pair it again.`,
      confirmLabel: 'Remove camera',
      onConfirm: () => {
        void (async () => {
          setPendingConfirmBusy(true);
          try {
            await deleteDevice(device);
            // provide restrained success feedback (e.g. toast could be added here, but App.tsx might just clear modal)
          } finally {
            setPendingConfirmBusy(false);
            setPendingConfirm(null);
          }
        })();
      },
    });
  }

  async function deleteDevice(device: Device) {
    try {
      setError('');
      await request(`/api/devices/${device.id}`, { method: 'DELETE' });
      setSelectedDeviceId(null);
      setSelectedCamera(null);
      pushRoute('/cameras');
      setPage('cameras');
      await loadCameras();
    } catch (caught) {
      setError(
        friendlyError(caught, 'The device couldn’t be removed. Try again.'),
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
        friendlyError(
          caught,
          'This camera could not be removed from your view.',
        ),
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
        'Deleting your account permanently removes your Beacon household, paired cameras, settings, motion history, and camera activity. Live connections stop immediately.',
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
      pushRoute('/');
      setPage('dashboard');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setReauthenticationOpen(true);
        return;
      }
      setError(
        friendlyError(caught, 'Your account couldn’t be deleted. Try again.'),
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
        friendlyError(
          caught,
          'The camera couldn’t be paused or resumed. Try again.',
        ),
      );
    }
  }

  function openCameraSettings(deviceId: string) {
    setError('');
    pushRoute(`/cameras/${encodeURIComponent(deviceId)}/settings`);
    window.history.replaceState(
      {
        ...window.history.state,
        cameraSettingsBackgroundPage: page,
        cameraSettingsBackgroundCameraId: selectedCamera?.id,
      },
      '',
      window.location.href,
    );
    setSelectedDeviceId(deviceId);
  }

  function closeCameraSettings() {
    setSelectedDeviceId(null);
    goBack(() => {
      replaceRoute('/cameras');
      setPage('cameras');
      setSelectedCamera(null);
    });
  }

  function openCamera(camera: Camera) {
    pushRoute(`/cameras/${encodeURIComponent(camera.id)}`);
    setSelectedDeviceId(null);
    setSelectedCamera(camera);
  }

  /** `defaultIds` is the set Home is showing right now (its computed
   * fallback when nothing is saved yet, or the saved list once there is
   * one) -- toggling edits from what's actually on screen. */
  function toggleFavorite(deviceId: string, defaultIds: string[]) {
    if (!household) return;
    const base = favoriteDeviceIds ?? defaultIds;
    const next = base.includes(deviceId)
      ? base.filter((id) => id !== deviceId)
      : [...base, deviceId];
    saveFavoriteDeviceIds(household.id, next);
    setFavoriteDeviceIds(next);
  }

  if (window.location.pathname.startsWith('/g/')) return <GuestViewPage />;
  if (window.location.pathname.startsWith('/shared/'))
    return <SharedRecordingPage />;
  if (window.location.pathname === '/camera-mode/setup')
    return (
      <BrowserCameraMode
        standalone
        onBack={() => window.location.assign('/')}
      />
    );
  if (window.location.pathname === '/pair') return <PairLinkPage />;
  if (window.location.pathname === '/auth/desktop/complete')
    return <DesktopAuthReturnPage />;
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
  if (page === 'contact')
    return <ContactPage available={capabilities?.contact !== false} />;
  if (page === 'account deletion')
    return (
      <ContactPage
        accountDeletion
        available={capabilities?.contact !== false}
      />
    );

  if (loading)
    return (
      <main className="shell loading-shell">
        <Brand />
        <p role="status">Opening your workspace…</p>
      </main>
    );

  if (startupError)
    return (
      <main className="shell loading-shell startup-error">
        <Brand />
        <p role="alert">{startupError}</p>
        <button className="primary" onClick={retryStartup} type="button">
          Try again
        </button>
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
        googleAvailable={capabilities?.auth.google !== false}
        onSubmit={(event) => void authenticate(event)}
        onMode={() => {
          setError('');
          setMode(mode === 'login' ? 'register' : 'login');
        }}
      />
    );

  const cameraSettingsOverlay = selectedDeviceId && (
    <ModalDialog
      className="camera-settings-dialog"
      labelledBy="camera-settings-title"
      onDismiss={closeCameraSettings}
    >
      <section className="camera-settings-panel">
        <CameraSettings
          cameras={cameras.filter(
            (camera) => camera.deviceId === selectedDeviceId,
          )}
          device={devices.find((device) => device.id === selectedDeviceId)}
          error={error}
          onBack={closeCameraSettings}
          onLive={openCamera}
          onRename={(device, name) => void renameDevice(device, name)}
          onDelete={(device) => requestDeleteDevice(device)}
          onLeave={(device) =>
            requestLeaveHostCamera(
              cameras.find((camera) => camera.deviceId === device.id)!,
            )
          }
          onCameraRename={(camera, name) => void renameCamera(camera, name)}
          onCameraDelete={(camera) => requestDeleteCamera(camera)}
          onCameraLeave={(camera) => requestLeaveCamera(camera)}
          onPrivacy={(device) => void setPrivacy(device)}
          onSwitchSource={(camera) => void switchSource(camera)}
          onReconnect={(device) => openPairing(device.id)}
          canManageSettings={
            household?.role === 'owner' || household?.role === 'admin'
          }
          driveState={drive.state}
        />
      </section>
    </ModalDialog>
  );

  // Previous / next camera from the keyboard (ADR 0090): one stop per device.
  function stepCamera(direction: -1 | 1) {
    if (!selectedCamera) return;
    const stops = groupCamerasByDevice(cameras).filter(
      (camera) => camera.enabled && !camera.credentialRevoked,
    );
    const index = stops.findIndex(
      (camera) => camera.deviceId === selectedCamera.deviceId,
    );
    if (stops.length < 2 || index < 0) return;
    const next = stops[(index + direction + stops.length) % stops.length];
    if (next) openCamera(next);
  }

  if (selectedCamera) {
    const liveDevice = devices.find(
      (device) => device.id === selectedCamera.deviceId,
    );
    const siblings = cameras.filter(
      (camera) => camera.deviceId === selectedCamera.deviceId,
    );
    return (
      <>
        <LivePlayerSlot
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
          onBack={() => goBack(() => navigate('cameras'))}
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
          onDevice={() => openCameraSettings(selectedCamera.deviceId)}
          canRecord={household?.role === 'owner'}
          drive={drive}
          canFlip={selectedCamera.canFlip ?? true}
          canPause={selectedCamera.canPause ?? true}
          onStep={stepCamera}
          canEditZones={
            (household?.role === 'owner' || household?.role === 'admin') &&
            liveDevice?.platform === 'android'
          }
          canCast={household?.role === 'owner' || household?.role === 'admin'}
        />
        {cameraSettingsOverlay}
        {pendingConfirm && (
          <ConfirmDialog
            title={pendingConfirm.title}
            description={pendingConfirm.description}
            confirmLabel={pendingConfirm.confirmLabel}
            busy={pendingConfirmBusy}
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm(null)}
          />
        )}
        {reauthenticationOpen && (
          <ReauthenticationDialog
            onCancel={() => setReauthenticationOpen(false)}
            onConfirmed={() => {
              setReauthenticationOpen(false);
              void deleteAccount();
            }}
          />
        )}
      </>
    );
  }

  // One physical host (phone, tablet, or computer) is one user-facing
  // Camera, even when it has multiple lenses/sources registered. The
  // backend keeps cameras and devices distinct; this is purely a frontend
  // presentation grouping.
  const hostCameras = groupCamerasByDevice(cameras);
  const pendingDevices = devices.filter(
    (device) => !cameras.some((camera) => camera.deviceId === device.id),
  );
  // The header and body share one page-container primitive, so they must
  // resolve to the same width tier -- computed once and reused by both.
  const pageWidthClass = contentWidthClass(page);
  return (
    <SidebarProvider>
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
        <main className="main-content" id="main-content" tabIndex={-1}>
          <header className="app-topbar">
            <div
              className={`page-content-inner page-header-row ${pageWidthClass}`}
            >
              <div className="app-topbar-left">
                <SidebarTrigger />
                <div className="mobile-brand-header">
                  <span className="mark">
                    <Icon name="camera" />
                  </span>{' '}
                  Beacon
                </div>
                <div className="app-topbar-title">
                  <h1 ref={pageHeading} tabIndex={-1} className="page-title">
                    {pageLabels[page]}
                  </h1>
                </div>
              </div>
              <div className="app-topbar-actions">
                {pagesWithAddCamera.has(page) &&
                  household?.role !== 'viewer' &&
                  household?.role !== 'guest' && (
                    <button
                      className="btn primary"
                      onClick={() => navigate('camera mode')}
                    >
                      <Icon name="plus" />
                      <span>Add camera</span>
                    </button>
                  )}
              </div>
            </div>
          </header>

          <div className={`page-content-inner page-body ${pageWidthClass}`}>
            {error && (
              <ErrorNotice message={error} onDismiss={() => setError('')} />
            )}
            {camerasError && (page === 'dashboard' || page === 'cameras') && (
              <ErrorNotice message={camerasError} onRetry={retryCameras} />
            )}
            {activityNotice && (
              <p className="activity-toast" role="status">
                <Icon name="camera" />
                {activityNotice}
              </p>
            )}

            {page === 'dashboard' &&
              cameras.length === 0 &&
              !camerasError &&
              (household?.role === 'owner' || household?.role === 'admin' ? (
                <section className="dash-empty">
                  <h1>Add your first device</h1>
                  <p>Turn a spare phone, tablet, or computer into a camera.</p>
                  <button
                    className="btn primary"
                    onClick={() => navigate('camera mode')}
                  >
                    <Icon name="plus" />
                    Add device
                  </button>
                </section>
              ) : (
                <section className="dash-empty">
                  <h1>No cameras shared with you yet</h1>
                  <p>
                    Ask the household owner or an admin to grant you access to a
                    camera from Settings &rarr; Household sharing.
                  </p>
                </section>
              ))}

            {page === 'dashboard' &&
              cameras.length > 0 &&
              (() => {
                const FAVORITES_DEFAULT = 4;
                const attentionCameras = hostCameras.filter((camera) => {
                  const state = cameraStatus(camera);
                  return state.tone !== 'privacy' && !state.available;
                });
                const attentionCount = attentionCameras.length;
                const attentionCamera = attentionCameras[0];
                const privacyCameras = hostCameras.filter(
                  (camera) => cameraStatus(camera).tone === 'privacy',
                );
                const readyCount = hostCameras.filter(
                  (camera) => cameraStatus(camera).available,
                ).length;

                const defaultFavoriteIds = hostCameras
                  .slice(0, FAVORITES_DEFAULT)
                  .map((camera) => camera.deviceId);
                const effectiveFavoriteIds =
                  favoriteDeviceIds ?? defaultFavoriteIds;
                const favoriteCameras = effectiveFavoriteIds
                  .map((deviceId) =>
                    hostCameras.find((camera) => camera.deviceId === deviceId),
                  )
                  .filter((camera): camera is Camera => Boolean(camera));

                const hour = new Date().getHours();
                const greeting =
                  hour < 5 || hour >= 18
                    ? 'Good evening'
                    : hour < 12
                      ? 'Good morning'
                      : 'Good afternoon';

                let subtitle = `${readyCount} of ${hostCameras.length} camera${
                  hostCameras.length === 1 ? '' : 's'
                } ${hostCameras.length === 1 ? 'is' : 'are'} ready to view.`;
                if (attentionCount === 0 && privacyCameras.length > 0) {
                  subtitle += ` ${privacyCameras.length} ${
                    privacyCameras.length === 1 ? 'has' : 'have'
                  } privacy on.`;
                }

                let attentionTitle = `${attentionCount} cameras need attention`;
                let attentionDesc =
                  'Multiple cameras are offline or need to be reconnected.';
                if (attentionCount === 1) {
                  attentionTitle = `${attentionCamera!.deviceName} needs attention`;
                  attentionDesc = isLocalBrowserCamera(
                    attentionCamera!.deviceId,
                  )
                    ? 'This browser was used as the camera. Open Camera Mode here to start it again.'
                    : cameraNeedsPairing(attentionCamera!)
                      ? 'Camera needs to be paired.'
                      : 'Camera is offline. Reconnect it to restore live viewing.';
                } else if (attentionCount > 1 && attentionCount <= 4) {
                  const offlineNames = attentionCameras
                    .filter((camera) => !cameraNeedsPairing(camera))
                    .map((camera) => camera.deviceName);
                  const pairingNames = attentionCameras
                    .filter((camera) => cameraNeedsPairing(camera))
                    .map((camera) => camera.deviceName);
                  const parts: string[] = [];
                  if (offlineNames.length > 0) {
                    parts.push(
                      offlineNames.length === 1
                        ? `${offlineNames[0]} is offline`
                        : offlineNames.length === 2
                          ? `${offlineNames.join(' and ')} are offline`
                          : `${offlineNames.slice(0, -1).join(', ')} and ${offlineNames[offlineNames.length - 1]} are offline`,
                    );
                  }
                  if (pairingNames.length > 0) {
                    parts.push(
                      pairingNames.length === 1
                        ? `${pairingNames[0]} needs pairing`
                        : pairingNames.length === 2
                          ? `${pairingNames.join(' and ')} need pairing`
                          : `${pairingNames.slice(0, -1).join(', ')} and ${pairingNames[pairingNames.length - 1]} need pairing`,
                    );
                  }
                  attentionDesc = parts.join('. ') + '.';
                }

                return (
                  <div className="home-dashboard">
                    <div className="home-welcome">
                      <h2>{greeting}</h2>
                      <p>{subtitle}</p>
                    </div>

                    {attentionCount > 0 && (
                      <section className="home-statusbar">
                        <div className="home-status-icon">
                          <Icon name="alert" />
                        </div>
                        <div className="home-status-copy">
                          <strong>{attentionTitle}</strong>
                          <span>{attentionDesc}</span>
                        </div>
                        {privacyCameras.length > 0 && (
                          <span className="pill">
                            {privacyCameras.length} privacy on
                          </span>
                        )}
                        {attentionCount === 1 ? (
                          isLocalBrowserCamera(attentionCamera!.deviceId) ? (
                            <button
                              className="home-statuslink"
                              onClick={() => {
                                navigate('camera mode');
                                setBrowserCameraActive(true);
                              }}
                            >
                              Continue camera mode &rarr;
                            </button>
                          ) : cameraCanReconnect(attentionCamera!) ? (
                            <button
                              className="home-statuslink"
                              onClick={() =>
                                openPairing(attentionCamera!.deviceId)
                              }
                            >
                              Reconnect {attentionCamera!.deviceName} &rarr;
                            </button>
                          ) : (
                            <button
                              className="home-statuslink"
                              onClick={() =>
                                openCameraSettings(attentionCamera!.deviceId)
                              }
                            >
                              Check status &rarr;
                            </button>
                          )
                        ) : (
                          <button
                            className="home-statuslink"
                            onClick={() => navigate('cameras')}
                          >
                            Review {attentionCount} cameras &rarr;
                          </button>
                        )}
                      </section>
                    )}

                    <div className="home-layout">
                      <section className="home-section">
                        <div className="home-section-top">
                          <h3>Favorites</h3>
                          <button
                            type="button"
                            className="textbtn"
                            onClick={() => setFavoritesEditorOpen(true)}
                          >
                            Edit
                          </button>
                        </div>

                        {favoriteCameras.length === 0 ? (
                          <div className="home-favorites-empty">
                            <p>No favorites chosen yet.</p>
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={() => setFavoritesEditorOpen(true)}
                            >
                              Choose favorites
                            </button>
                          </div>
                        ) : (
                          <div className="favorites-grid">
                            {favoriteCameras.map((camera) => (
                              <FavoriteCameraCard
                                key={camera.deviceId}
                                camera={camera}
                                needsPairing={cameraNeedsPairing(camera)}
                                canReconnect={cameraCanReconnect(camera)}
                                onOpen={openCamera}
                                onDevice={openCameraSettings}
                                onReconnect={(deviceId) =>
                                  openPairing(deviceId)
                                }
                                onRemoveFavorite={(deviceId) =>
                                  toggleFavorite(deviceId, defaultFavoriteIds)
                                }
                                {...(isLocalBrowserCamera(camera.deviceId)
                                  ? {
                                      onContinueCamera: () => {
                                        navigate('camera mode');
                                        setBrowserCameraActive(true);
                                      },
                                    }
                                  : {})}
                              />
                            ))}
                          </div>
                        )}

                        <div className="footerline">
                          <button
                            type="button"
                            className="textbtn"
                            onClick={() => navigate('cameras')}
                          >
                            View all {hostCameras.length} device
                            {hostCameras.length === 1 ? '' : 's'} &rarr;
                          </button>
                        </div>
                      </section>

                      <aside className="home-sidecol">
                        <section className="sidecard">
                          <div className="sidehead">
                            <h3>Latest activity</h3>
                            <button
                              type="button"
                              className="textbtn"
                              onClick={() => navigate('events')}
                            >
                              See all
                            </button>
                          </div>
                          <div className="feed">
                            <LatestActivityPreview
                              refreshRevision={motionEventRevision}
                              onCamera={(cameraId) => {
                                const camera = cameras.find(
                                  (item) => item.id === cameraId,
                                );
                                if (camera) openCamera(camera);
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            className="allactivity"
                            onClick={() => navigate('events')}
                          >
                            Open Activity
                          </button>
                        </section>

                        <section className="home-shortcut">
                          <button
                            type="button"
                            onClick={() => navigate('cameras')}
                          >
                            <span className="q">
                              <Icon name="grid" />
                            </span>
                            <span>
                              <b>Manage devices</b>
                              <small>
                                Connections, names and camera settings
                              </small>
                            </span>
                            <Icon name="chevronRight" />
                          </button>
                        </section>
                      </aside>
                    </div>

                    {favoritesEditorOpen && (
                      <FavoritesEditor
                        cameras={hostCameras}
                        favoriteDeviceIds={effectiveFavoriteIds}
                        onToggle={(deviceId) =>
                          toggleFavorite(deviceId, defaultFavoriteIds)
                        }
                        onDismiss={() => setFavoritesEditorOpen(false)}
                      />
                    )}
                  </div>
                );
              })()}

            {page === 'wall' && (
              <CameraWall
                key={wallStorageKey(user.id, household?.id ?? '')}
                storageKey={wallStorageKey(user.id, household?.id ?? '')}
                cameras={groupCamerasByDevice(cameras)}
                onBack={() => navigate('cameras')}
                onOpen={(camera) => openCamera(camera)}
              />
            )}

            {page === 'cameras' && (
              <section className="camera-catalog" aria-label="Your cameras">
                <HouseholdModeBar />
                {groupCamerasByDevice(cameras).length > 1 && (
                  <div className="camera-catalog-tools">
                    <button
                      className="secondary"
                      onClick={() => navigate('wall')}
                      type="button"
                    >
                      <Icon name="grid" /> Camera wall
                    </button>
                  </div>
                )}
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
                      camerasError ? null : (
                        <p className="empty">No cameras yet.</p>
                      )
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
                            {...(cameraCanReconnect(camera)
                              ? {
                                  onReconnect: (item: Camera) =>
                                    openPairing(item.deviceId),
                                }
                              : {})}
                            {...(isLocalBrowserCamera(camera.deviceId)
                              ? {
                                  onContinueCamera: () => {
                                    navigate('camera mode');
                                    setBrowserCameraActive(true);
                                  },
                                }
                              : {})}
                            {...(household?.role === 'owner' ||
                            household?.role === 'admin'
                              ? {
                                  onRename: (item: Camera, name: string) =>
                                    renameHostCamera(item, name),
                                }
                              : {})}
                            onDelete={(item) => requestDeleteHostCamera(item)}
                            onLeave={(item) => requestLeaveHostCamera(item)}
                          />
                        ))}
                      </div>
                    )
                  }
                </CameraBrowser>
              </section>
            )}
            {page === 'events' && (
              <>
                <EventsViewSwitch value={eventsView} onChange={setEventsView} />
                {eventsView === 'clips' ? (
                  <RecordingLibrary
                    key={`clips_${user.id}_${household?.id ?? ''}_${household?.role ?? ''}_${membershipRevision}`}
                    bookmarkStorageKey={`beacon_clip_bookmarks_${user.id}_${household?.id ?? ''}`}
                    cameras={cameras}
                    canDelete={household?.role === 'owner'}
                    canShare={household?.role === 'owner'}
                    focusRecordingId={focusRecordingId}
                    onFocusHandled={() => setFocusRecordingId(null)}
                    onOpenEvent={(motionEventId) => {
                      setFocusMotionEventId(motionEventId);
                      setEventsView('activity');
                    }}
                  />
                ) : (
                  <MotionEventList
                    key={`activity_${user.id}_${household?.id ?? ''}`}
                    filterStorageKey={`beacon_motion_filters_${user.id}_${household?.id ?? ''}`}
                    includeHouseholdActivity={
                      household?.role === 'owner' || household?.role === 'admin'
                    }
                    refreshRevision={motionEventRevision}
                    clearRevision={motionClearRevision}
                    cameras={cameras}
                    onCamera={(id) => {
                      const camera = cameras.find((item) => item.id === id);
                      if (camera) openCamera(camera);
                    }}
                    onViewClip={(recordingId: string) => {
                      setFocusRecordingId(recordingId);
                      setEventsView('clips');
                    }}
                    focusMotionEventId={focusMotionEventId}
                    onFocusHandled={() => setFocusMotionEventId(null)}
                  />
                )}
              </>
            )}
            {page === 'diagnostics' && (
              <Diagnostics
                key={`diagnostics_${user.id}_${household?.id ?? ''}_${household?.role ?? ''}`}
              />
            )}
            {page === 'settings' && (
              <SettingsPage
                cameras={cameras}
                user={user}
                household={household!}
                membershipRevision={membershipRevision}
                googleAvailable={capabilities?.auth.google !== false}
                webPushAvailable={capabilities?.notifications.webPush !== false}
                requestedSection={settingsSection}
                onSectionChange={(section) => {
                  pushRoute(`/settings?section=${section}`);
                  setSettingsSection(section);
                }}
                onDeleteAccount={requestDeleteAccount}
                onCurrentSessionRevoked={clearLocalSession}
                onUserChanged={() => {
                  void request<{ household: HouseholdSession; user: User }>(
                    '/api/auth/me',
                  )
                    .then((result) => {
                      setUser(result.user);
                      setHousehold(
                        result.household ?? { id: '', role: 'owner' },
                      );
                    })
                    .catch(() => undefined);
                }}
              />
            )}
            {page === 'camera mode' &&
              (household?.role === 'guest' ? (
                <section className="add-device-page">
                  <h2>Camera setup needs a household member</h2>
                  <p>
                    Guest access is for viewing shared cameras. Ask a household
                    member to create a one-time pairing code if you want to set
                    up this browser as a camera.
                  </p>
                  <a className="btn secondary" href="/camera-mode/setup">
                    Set up with a pairing code
                  </a>
                </section>
              ) : (
                <>
                  <AddCameraPage
                    onBack={() => navigate('dashboard')}
                    onPairAndroid={() => openPairing()}
                    onSetUpComputer={() => setComputerSetupOpen(true)}
                    onUseBrowser={() => setBrowserCameraActive(true)}
                  />
                  {computerSetupOpen && (
                    <ComputerCameraSetupDialog
                      onDismiss={() => setComputerSetupOpen(false)}
                    />
                  )}
                  {browserCameraActive && (
                    <BrowserCameraMode
                      canRecord={household?.role === 'owner'}
                      drive={drive}
                      onBack={() => setBrowserCameraActive(false)}
                    />
                  )}
                </>
              ))}
          </div>
        </main>
        {pairingOpen && (
          <PairingDialog
            busy={pairingBusy}
            code={pairingCode}
            error={error}
            state={pairingState}
            reconnecting={reconnectDeviceId.current !== null}
            onCopyError={() =>
              setError(
                'Couldn’t copy the setup link. Select it and copy it manually.',
              )
            }
            onDismiss={cancelPairing}
            onRetry={() => void createPairingCode()}
          />
        )}
        {cameraSettingsOverlay}
        {pendingConfirm && (
          <ConfirmDialog
            title={pendingConfirm.title}
            description={pendingConfirm.description}
            confirmLabel={pendingConfirm.confirmLabel}
            busy={pendingConfirmBusy}
            onConfirm={pendingConfirm.onConfirm}
            onCancel={() => setPendingConfirm(null)}
          />
        )}
        {reauthenticationOpen && (
          <ReauthenticationDialog
            onCancel={() => setReauthenticationOpen(false)}
            onConfirmed={() => {
              setReauthenticationOpen(false);
              void deleteAccount();
            }}
          />
        )}
      </div>
    </SidebarProvider>
  );
}
