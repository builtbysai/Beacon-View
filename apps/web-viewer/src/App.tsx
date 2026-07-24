import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
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

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [selectedCamera, setSelectedCamera] = useState<Camera | null>(null);

  const loadCameras = useCallback(async () => {
    const result = await request<{ cameras: Camera[] }>('/api/cameras');
    setCameras(result.cameras);
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
      setCameras([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    }
  }

  async function logout() {
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setCameras([]);
    setPairingCode('');
  }

  async function createPairingCode() {
    setError('');
    try {
      const result = await request<{ code: string }>('/api/pairing-codes', {
        body: '{}',
        method: 'POST',
      });
      setPairingCode(result.code);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    }
  }

  async function revoke(cameraId: string) {
    await request(`/api/cameras/${cameraId}/credential`, { method: 'DELETE' });
    await loadCameras();
  }

  if (loading) {
    return <main className="shell">Loading your secure workspace…</main>;
  }

  if (!user) {
    return (
      <main className="shell">
        <section className="card" aria-labelledby="page-title">
          <p className="eyebrow">Milestone 1</p>
          <h1 id="page-title">Beacon SecureView</h1>
          <p>Sign in to register and monitor your household camera devices.</p>
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

  return (
    <main className="shell">
      <section className="card wide" aria-labelledby="page-title">
        <div className="heading">
          <div>
            <p className="eyebrow">Household cameras</p>
            <h1 id="page-title">Beacon SecureView</h1>
            <p>{user.email}</p>
          </div>
          <button className="secondary" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        <button onClick={() => void createPairingCode()}>
          Create pairing code
        </button>
        {pairingCode && (
          <div className="pairing" role="status">
            <strong>{pairingCode}</strong>
            <span>Expires in 10 minutes and can be used once.</span>
          </div>
        )}
        {cameras.length === 0 ? (
          <p className="empty">No cameras are paired with this household.</p>
        ) : (
          <ul className="camera-list">
            {cameras.map((camera) => (
              <li key={camera.id}>
                <div>
                  <strong>{camera.name}</strong>
                  <span className={camera.online ? 'online' : 'offline'}>
                    {camera.online ? 'Online' : 'Offline'}
                  </span>
                </div>
                <button
                  className="secondary"
                  disabled={camera.credentialRevoked}
                  onClick={() => void revoke(camera.id)}
                >
                  {camera.credentialRevoked ? 'Credential revoked' : 'Revoke'}
                </button>
                <button
                  disabled={!camera.online || camera.credentialRevoked}
                  onClick={() => setSelectedCamera(camera)}
                >
                  View live
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
