import { useEffect, useState } from 'react';
import { ApiError, request } from './api';
import { Brand, Icon } from './Icon';
import { LiveVideo } from './LiveVideo';
import type { Camera } from './domain';
import './GuestViewPage.css';

type Status = 'entering' | 'invalid' | 'empty' | 'ready';

/** The public, no-account counterpart to the signed-in live view: opening
 * /g/:token redeems the guest link for a scoped cookie (see POST
 * /api/guest/enter) and then shows exactly the cameras and controls that
 * link was created with -- no settings, no rename, no remove, no recording. */
export function GuestViewPage() {
  const token = window.location.pathname.slice('/g/'.length);
  const [status, setStatus] = useState<Status>('entering');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await request('/api/guest/enter', {
          body: JSON.stringify({ token }),
          method: 'POST',
        });
        const result = await request<{ cameras: Camera[] }>(
          '/api/guest/cameras',
        );
        if (cancelled) return;
        setCameras(result.cameras);
        setStatus(result.cameras.length === 0 ? 'empty' : 'ready');
        if (result.cameras.length === 1) setSelectedId(result.cameras[0]!.id);
      } catch (error) {
        if (!cancelled) {
          setStatus('invalid');
          if (!(error instanceof ApiError)) console.error(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (status !== 'ready' && status !== 'empty') return;
    let active = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const result = await request<{ cameras: Camera[] }>(
          '/api/guest/cameras',
        );
        if (!active) return;
        setCameras(result.cameras);
        setSelectedId((current) =>
          current && result.cameras.some((camera) => camera.id === current)
            ? current
            : null,
        );
        setStatus(result.cameras.length ? 'ready' : 'empty');
      } catch (error) {
        if (
          active &&
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          setStatus('invalid');
          setSelectedId(null);
        }
      }
    };
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisibility = () => {
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status]);

  async function leaveGuestView() {
    await request('/api/guest/exit', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/');
  }

  if (status === 'entering')
    return (
      <main className="shell trust-shell pair-link-shell">
        <section className="trust-page" aria-labelledby="guest-view-title">
          <a className="trust-brand" href="/" aria-label="Beacon home">
            <Brand />
          </a>
          <p className="eyebrow">Shared camera</p>
          <h1 id="guest-view-title">Connecting…</h1>
        </section>
      </main>
    );

  if (status === 'invalid')
    return (
      <main className="shell trust-shell pair-link-shell">
        <section className="trust-page" aria-labelledby="guest-view-title">
          <a className="trust-brand" href="/" aria-label="Beacon home">
            <Brand />
          </a>
          <p className="eyebrow">Shared camera</p>
          <h1 id="guest-view-title">This link is no longer available.</h1>
          <p className="trust-lead">
            It may have expired or been turned off by whoever shared it. Ask
            them for a new link.
          </p>
          <a className="secondary button-link" href="/">
            Return to Beacon
          </a>
        </section>
      </main>
    );

  if (status === 'empty')
    return (
      <main className="shell trust-shell pair-link-shell">
        <section className="trust-page" aria-labelledby="guest-view-title">
          <a className="trust-brand" href="/" aria-label="Beacon home">
            <Brand />
          </a>
          <p className="eyebrow">Shared camera</p>
          <h1 id="guest-view-title">Nothing to show right now.</h1>
          <p className="trust-lead">
            The cameras on this link aren’t available at the moment.
          </p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void leaveGuestView()}
          >
            Leave shared view
          </button>
        </section>
      </main>
    );

  const selected = cameras.find((camera) => camera.id === selectedId);
  if (selected)
    return (
      <LiveVideo
        camera={selected}
        enabled={selected.enabled && !selected.credentialRevoked}
        privacyMode={selected.privacyMode}
        deviceName={selected.deviceName}
        viewerCount={selected.viewerCount}
        onBack={() => setSelectedId(null)}
        canFlip={false}
        canPause={false}
      />
    );

  return (
    <main className="shell guest-picker-shell">
      <header className="guest-picker-header">
        <Brand />
        <p className="eyebrow">Shared cameras</p>
        <button
          type="button"
          className="btn secondary"
          onClick={() => void leaveGuestView()}
        >
          Leave shared view
        </button>
      </header>
      <div className="guest-camera-grid">
        {cameras.map((camera) => (
          <button
            key={camera.id}
            type="button"
            className="guest-camera-card"
            onClick={() => setSelectedId(camera.id)}
          >
            <Icon name="camera" />
            <span className="guest-camera-name">{camera.name}</span>
            <span className="guest-camera-device">{camera.deviceName}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
