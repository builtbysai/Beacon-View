import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { AnnounceRegistry } from './announce';
import { cameraStatus } from './camera-status';
import { WALL_TILE_KBPS } from './data-saver';
import { Icon } from './Icon';
import { LiveVideo } from './LiveVideo';
import { PushToTalk } from './push-to-talk';
import type { Camera } from './domain';
import './CameraWall.css';

/** More simultaneous streams than this strain the cameras and the network. */
export const MAX_WALL_TILES = 9;

const LAYOUT_KEY = 'beacon.wall.columns.v1';
export type WallColumns = 'auto' | 1 | 2 | 3;

export function loadWallColumns(): WallColumns {
  try {
    const value = localStorage.getItem(LAYOUT_KEY);
    return value === '1' || value === '2' || value === '3'
      ? (Number(value) as 1 | 2 | 3)
      : 'auto';
  } catch {
    return 'auto';
  }
}

/** The grid for `count` live tiles: 1 camera fills the page, 2 sit side by
 * side, up to 4 form 2 x 2, and so on. */
export function autoColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

/** Only tiles near the screen stream (scrolling a long wall starts and
 * stops cameras as you go). Without IntersectionObserver, all do. */
function useNearScreen(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, near];
}

function WallTile({
  camera,
  onOpen,
  registry,
}: {
  camera: Camera;
  onOpen: (camera: Camera) => void;
  registry: AnnounceRegistry;
}) {
  const [ref, near] = useNearScreen();
  const status = cameraStatus(camera);
  return (
    <div className="wall-tile" ref={ref}>
      {near && status.available ? (
        <LiveVideo
          announce={registry}
          camera={camera}
          compact
          deviceName={camera.deviceName}
          enabled
          maxVideoKbps={WALL_TILE_KBPS}
          privacyMode={camera.privacyMode}
        />
      ) : (
        <div className="wall-tile-idle" data-tone={status.tone}>
          <Icon name="camera" />
          <span>{status.available ? 'Loading…' : status.label}</span>
        </div>
      )}
      <button
        aria-label={`Open ${camera.name} full size`}
        className="wall-tile-open"
        onClick={() => onOpen(camera)}
        type="button"
      >
        <span className="wall-tile-name">{camera.name}</span>
        <span className="wall-tile-device">{camera.deviceName}</span>
      </button>
    </div>
  );
}

/**
 * Camera wall (ADR 0091): every available camera live in one grid, tap a
 * tile to open it full size. Tiles use Data saver bitrates, and at most
 * `MAX_WALL_TILES` stream at once. Web and desktop only.
 */
export function CameraWall({
  cameras,
  onBack,
  onOpen,
}: {
  /** One camera per device (its active source), already in display order. */
  cameras: Camera[];
  onBack: () => void;
  onOpen: (camera: Camera) => void;
}) {
  const [columns, setColumns] = useState<WallColumns>(loadWallColumns);
  const wallRef = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const registry = useMemo(() => new AnnounceRegistry(), []);

  const live = useMemo(
    () => cameras.filter((camera) => cameraStatus(camera).available),
    [cameras],
  );
  const shown = live.slice(0, MAX_WALL_TILES);
  const waiting = cameras.filter((camera) => !shown.includes(camera));
  const columnCount = columns === 'auto' ? autoColumns(shown.length) : columns;

  const summary = useSyncExternalStore(
    registry.subscribe.bind(registry),
    () => `${registry.reachable}/${registry.speaking}`,
  );
  const [reachable = 0, speaking = 0] = summary.split('/').map(Number);

  const announce = useRef<PushToTalk | null>(null);
  announce.current ??= new PushToTalk(
    () => registry.speaking > 0,
    () => registry.startAll(),
    () => registry.stopAll(),
  );

  useEffect(() => () => registry.stopAll(), [registry]);
  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === wallRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function chooseColumns(value: WallColumns) {
    setColumns(value);
    try {
      localStorage.setItem(LAYOUT_KEY, String(value));
    } catch {
      // The layout then lasts for this page only.
    }
  }

  function toggleFullscreen() {
    const wall = wallRef.current;
    if (!wall?.requestFullscreen) return;
    void (
      fullscreen ? document.exitFullscreen() : wall.requestFullscreen()
    ).catch(() => undefined);
  }

  return (
    <section
      aria-label="Camera wall"
      className="camera-wall"
      ref={wallRef}
      style={{ '--wall-columns': columnCount } as CSSProperties}
    >
      <header className="camera-wall-toolbar">
        <button
          aria-label="Back to cameras"
          className="secondary"
          onClick={onBack}
          type="button"
        >
          <Icon name="chevronLeft" />
        </button>
        <h1>Camera wall</h1>
        <div className="camera-wall-actions">
          <label className="camera-wall-layout">
            <span className="visually-hidden">Columns</span>
            <select
              className="input-field"
              onChange={(event) =>
                chooseColumns(
                  event.target.value === 'auto'
                    ? 'auto'
                    : (Number(event.target.value) as 1 | 2 | 3),
                )
              }
              value={String(columns)}
            >
              <option value="auto">Auto layout</option>
              <option value="1">1 column</option>
              <option value="2">2 columns</option>
              <option value="3">3 columns</option>
            </select>
          </label>
          <button
            aria-pressed={speaking > 0}
            className={speaking > 0 ? 'primary' : 'secondary'}
            disabled={reachable === 0 && speaking === 0}
            onPointerCancel={() => announce.current?.release()}
            onPointerDown={(event) => {
              if (event.button === 0) announce.current?.press();
            }}
            onPointerLeave={() => announce.current?.release()}
            onPointerUp={() => announce.current?.release()}
            onClick={(event) => {
              if (event.detail !== 0) return;
              announce.current?.press();
              announce.current?.release();
            }}
            title="Talk through every camera that allows it. Hold to talk, or tap to toggle."
            type="button"
          >
            <Icon name={speaking > 0 ? 'micOff' : 'mic'} />
            {speaking > 0
              ? `Announcing · ${speaking} ${speaking === 1 ? 'camera' : 'cameras'}`
              : `Announce${reachable > 0 ? ` · ${reachable}` : ''}`}
          </button>
          <button
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            className="secondary"
            onClick={toggleFullscreen}
            type="button"
          >
            <Icon name={fullscreen ? 'minimize' : 'maximize'} />
          </button>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="camera-wall-empty" role="status">
          No camera is ready to view right now. Cameras that are online will
          appear here.
        </p>
      ) : (
        <div className="camera-wall-grid">
          {shown.map((camera) => (
            <WallTile
              camera={camera}
              key={camera.id}
              onOpen={onOpen}
              registry={registry}
            />
          ))}
        </div>
      )}
      {waiting.length > 0 && (
        <p className="camera-wall-note">
          {live.length > MAX_WALL_TILES
            ? `Showing ${MAX_WALL_TILES} of ${live.length} cameras. `
            : ''}
          {waiting.length === 1
            ? '1 camera is offline, paused, or not shown.'
            : `${waiting.length} cameras are offline, paused, or not shown.`}
        </p>
      )}
    </section>
  );
}
