import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { deviceLifecycle, nextPairingState } from './lifecycle';
import type { PairingLifecycle } from './lifecycle';
import { LiveVideo } from './LiveVideo';

interface User {
  id: string;
  email: string;
}

interface Camera {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  credentialRevoked: boolean;
}

type Page = 'dashboard' | 'cameras' | 'settings';

function csrfToken(): string {
  return (
    document.cookie
      .split('; ')
      .find((value) => value.startsWith('beacon_csrf='))
      ?.split('=')[1] ?? ''
  );
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options?.method && options.method !== 'GET'
        ? { 'x-csrf-token': csrfToken() }
        : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? 'Request failed');
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

function eventsUrl(): string {
  const url = new URL('/api/events', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>('dashboard');
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingState, setPairingState] = useState<PairingLifecycle>('pending');
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);
  const [highlightedCameraId, setHighlightedCameraId] = useState<string | null>(
    null,
  );
  const returnPage = useRef<Page>('cameras');

  const loadCameras = useCallback(async () => {
    const result = await request<{ cameras: Camera[] }>('/api/cameras');
    setCameras(result.cameras);
    return result.cameras;
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
                setPage('cameras');
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
  }, [loadCameras, user]);

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
    setPage(returnPage.current);
  }

  async function revoke(cameraId: string) {
    await request(`/api/cameras/${cameraId}/credential`, { method: 'DELETE' });
    await loadCameras();
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
    return (
      <LiveVideo
        camera={selectedCamera}
        onBack={() => setSelectedCamera(null)}
      />
    );
  }

  const onlineCount = cameras.filter((camera) => camera.online).length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Beacon</p>
          <h1>SecureView</h1>
        </div>
        <nav aria-label="Primary navigation">
          {(['dashboard', 'cameras', 'settings'] as const).map((item) => (
            <button
              className={page === item ? 'nav-active' : 'nav-button'}
              key={item}
              onClick={() => setPage(item)}
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
          <button onClick={openPairing}>Pair device</button>
        </header>
        {error && <p role="alert">{error}</p>}
        {page === 'dashboard' && (
          <section className="dashboard-grid">
            <article className="metric-card">
              <span>Cameras</span>
              <strong>{cameras.length}</strong>
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
                onRevoke={(id) => void revoke(id)}
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
              onRevoke={(id) => void revoke(id)}
            />
          </section>
        )}
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

function CameraList({
  cameras,
  highlightedCameraId,
  onLive,
  onRevoke,
}: {
  cameras: Camera[];
  highlightedCameraId: string | null;
  onLive: (camera: Camera) => void;
  onRevoke: (cameraId: string) => void;
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
              <span className={state}>{state.toUpperCase()}</span>
            </div>
            <button
              className="secondary"
              disabled={camera.credentialRevoked}
              onClick={() => onRevoke(camera.id)}
            >
              {camera.credentialRevoked ? 'Credential revoked' : 'Revoke'}
            </button>
            <button
              disabled={!camera.online || camera.credentialRevoked}
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
