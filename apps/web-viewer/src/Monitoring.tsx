import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { LiveVideo } from './LiveVideo';

export interface MonitorCamera {
  credentialRevoked: boolean;
  deviceId: string;
  deviceName: string;
  enabled: boolean;
  id: string;
  name: string;
  online: boolean;
  platform: 'android' | 'browser';
  privacyMode?: boolean;
  streaming: boolean;
  viewerCount: number;
}

interface MonitorDevice {
  id: string;
  name: string;
}

export type GridSize = 1 | 2 | 4 | 6 | 9 | 12 | 16;

export interface Workspace {
  cameraIds: string[];
  fullscreenPreference: boolean;
  id: string;
  layout: GridSize;
  name: string;
  refreshPreference: 'visible' | 'continuous';
}

const GRID_SIZES: GridSize[] = [1, 2, 4, 6, 9, 12, 16];
const STORAGE_VERSION = 1;

export function loadWorkspaces(
  storageKey: string,
  cameraIds: string[],
): Workspace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '') as {
      version?: number;
      workspaces?: Workspace[];
    };
    if (parsed.version === STORAGE_VERSION && parsed.workspaces?.length)
      return parsed.workspaces;
  } catch {
    // Invalid local preferences safely fall back to a new workspace.
  }
  return [
    {
      cameraIds,
      fullscreenPreference: false,
      id: 'home',
      layout: cameraIds.length <= 1 ? 1 : cameraIds.length <= 4 ? 4 : 9,
      name: 'Home',
      refreshPreference: 'visible',
    },
  ];
}

function useTileVisibility(continuous: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);
  const [foreground, setForeground] = useState(!document.hidden);

  useEffect(() => {
    const onVisibility = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (continuous || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin: '240px' },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [continuous]);

  return { active: foreground && visible, ref };
}

const MonitorTile = memo(function MonitorTile({
  camera,
  continuous,
  expanded,
  onDevice,
  onExpand,
  onMove,
  onSwitchSource,
  siblings,
}: {
  camera: MonitorCamera;
  continuous: boolean;
  expanded: boolean;
  onDevice: () => void;
  onExpand: () => void;
  onMove: (direction: -1 | 1) => void;
  onSwitchSource: (cameraId: string) => void;
  siblings: MonitorCamera[];
}) {
  const { active, ref } = useTileVisibility(continuous);
  const unavailable =
    !camera.online ||
    !camera.enabled ||
    camera.credentialRevoked ||
    camera.privacyMode;

  return (
    <article
      aria-label={`${camera.name} camera tile`}
      className={`monitor-tile${expanded ? ' tile-expanded' : ''}`}
      draggable
      ref={ref}
      tabIndex={0}
    >
      <header>
        <div>
          <strong>{camera.name}</strong>
          <span>{camera.deviceName}</span>
        </div>
        <span
          className={
            camera.streaming
              ? 'streaming'
              : camera.online
                ? 'online'
                : 'offline'
          }
        >
          {camera.streaming ? 'LIVE' : camera.online ? 'ONLINE' : 'OFFLINE'}
        </span>
      </header>
      {unavailable ? (
        <div className="tile-unavailable" role="status">
          <strong>
            {camera.credentialRevoked
              ? 'Access revoked'
              : camera.privacyMode
                ? 'Privacy is on'
                : !camera.enabled
                  ? 'Camera disabled'
                  : 'Camera offline'}
          </strong>
          <span>
            {camera.privacyMode
              ? 'Turn privacy off from the device settings when you are ready.'
              : camera.online
                ? 'Open the device to restore access.'
                : 'Beacon will show video when the camera reconnects.'}
          </span>
        </div>
      ) : (
        <LiveVideo
          camera={camera}
          compact
          deviceName={camera.deviceName}
          enabled={active}
          onDevice={onDevice}
          viewerCount={camera.viewerCount}
        />
      )}
      <footer>
        <span>
          {camera.viewerCount} {camera.viewerCount === 1 ? 'viewer' : 'viewers'}
        </span>
        {siblings.length > 1 && (
          <label>
            <span className="visually-hidden">Switch {camera.name} source</span>
            <select
              aria-label={`Switch ${camera.name} source`}
              value={camera.id}
              onChange={(event) => onSwitchSource(event.target.value)}
            >
              {siblings.map((sibling) => (
                <option key={sibling.id} value={sibling.id}>
                  {sibling.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          aria-label={`${expanded ? 'Exit' : 'Open'} ${camera.name} fullscreen`}
          className="secondary"
          onClick={onExpand}
          type="button"
        >
          {expanded ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
        <div className="reorder-controls" aria-label={`Reorder ${camera.name}`}>
          <button
            aria-label={`Move ${camera.name} earlier`}
            className="link"
            onClick={() => onMove(-1)}
            type="button"
          >
            ←
          </button>
          <button
            aria-label={`Move ${camera.name} later`}
            className="link"
            onClick={() => onMove(1)}
            type="button"
          >
            →
          </button>
        </div>
      </footer>
    </article>
  );
});

export function Monitoring({
  cameras,
  devices,
  onDevice,
  onSwitchSource,
  storageKey,
}: {
  cameras: MonitorCamera[];
  devices: MonitorDevice[];
  onDevice: (deviceId: string) => void;
  onSwitchSource: (cameraId: string) => Promise<void>;
  storageKey: string;
}) {
  const [workspaces, setWorkspaces] = useState(() =>
    loadWorkspaces(
      storageKey,
      cameras.map((camera) => camera.id),
    ),
  );
  const [selectedId, setSelectedId] = useState(workspaces[0]?.id ?? 'home');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState('');
  const dragId = useRef<string | null>(null);
  const workspace = workspaces.find((item) => item.id === selectedId)!;

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ version: STORAGE_VERSION, workspaces }),
    );
  }, [storageKey, workspaces]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const known = new Set(cameras.map((camera) => camera.id));
    setWorkspaces((current) =>
      current.map((item) => ({
        ...item,
        cameraIds: item.cameraIds.filter((id) => known.has(id)),
      })),
    );
  }, [cameras]);

  function updateWorkspace(changes: Partial<Workspace>) {
    setWorkspaces((current) =>
      current.map((item) =>
        item.id === selectedId ? { ...item, ...changes } : item,
      ),
    );
  }

  function reorder(cameraId: string, targetId: string) {
    if (cameraId === targetId) return;
    const next = [...workspace.cameraIds];
    const from = next.indexOf(cameraId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, cameraId);
    updateWorkspace({ cameraIds: next });
  }

  function move(cameraId: string, direction: -1 | 1) {
    const index = workspace.cameraIds.indexOf(cameraId);
    const target = workspace.cameraIds[index + direction];
    if (target) reorder(cameraId, target);
  }

  function createWorkspace() {
    const name = window.prompt('Workspace name')?.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setWorkspaces((current) => [
      ...current,
      {
        cameraIds: cameras.map((camera) => camera.id),
        fullscreenPreference: false,
        id,
        layout: cameras.length <= 4 ? 4 : 9,
        name,
        refreshPreference: 'visible',
      },
    ]);
    setSelectedId(id);
  }

  const selectedCameras = useMemo(
    () =>
      workspace.cameraIds
        .map((id) => cameras.find((camera) => camera.id === id))
        .filter((camera): camera is MonitorCamera => Boolean(camera))
        .filter(
          (camera) =>
            (deviceFilter === 'all' || camera.deviceId === deviceFilter) &&
            (platformFilter === 'all' || camera.platform === platformFilter) &&
            (statusFilter === 'all' ||
              (statusFilter === 'online' && camera.online) ||
              (statusFilter === 'offline' && !camera.online) ||
              (statusFilter === 'live' && camera.streaming) ||
              (statusFilter === 'disabled' && !camera.enabled)),
        )
        .slice(0, workspace.layout),
    [cameras, deviceFilter, platformFilter, statusFilter, workspace],
  );

  const metrics = {
    live: cameras.filter((camera) => camera.streaming).length,
    offline: cameras.filter((camera) => !camera.online).length,
    online: cameras.filter((camera) => camera.online).length,
    viewers: cameras.reduce((sum, camera) => sum + camera.viewerCount, 0),
  };
  const activeFilterCount = [deviceFilter, statusFilter, platformFilter].filter(
    (value) => value !== 'all',
  ).length;

  return (
    <section aria-labelledby="monitoring-title" className="monitoring">
      <div className="monitor-toolbar">
        <div>
          <h3 id="monitoring-title">{workspace.name}</h3>
          <div className="health-strip" aria-label="Camera health overview">
            <span>{cameras.length} Cameras</span>
            <span>{metrics.online} Online</span>
            {metrics.offline > 0 && <span>{metrics.offline} Offline</span>}
            {metrics.live > 0 && <span>{metrics.live} Live</span>}
            <span>{metrics.viewers} Viewers</span>
          </div>
        </div>
        <label>
          Layout
          <select
            aria-label="Layout"
            value={workspace.layout}
            onChange={(event) =>
              updateWorkspace({
                layout: Number(event.target.value) as GridSize,
              })
            }
          >
            {GRID_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} camera{size === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workspace
          <select
            aria-label="Workspace"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" onClick={createWorkspace} type="button">
          New workspace
        </button>
      </div>

      {switchError && <p role="alert">{switchError}</p>}

      <details className="monitor-options">
        <summary>
          Filters &amp; playback
          {activeFilterCount > 0 ? ` · ${activeFilterCount} active` : ''}
        </summary>
        <div className="monitor-filters">
          <label>
            Device
            <select
              aria-label="Filter by device"
              value={deviceFilter}
              onChange={(event) => setDeviceFilter(event.target.value)}
            >
              <option value="all">All devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All states</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="live">Live</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            Platform
            <select
              aria-label="Filter by platform"
              value={platformFilter}
              onChange={(event) => setPlatformFilter(event.target.value)}
            >
              <option value="all">All platforms</option>
              <option value="android">Android</option>
              <option value="browser">Browser Camera</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              checked={workspace.refreshPreference === 'continuous'}
              type="checkbox"
              onChange={(event) =>
                updateWorkspace({
                  refreshPreference: event.target.checked
                    ? 'continuous'
                    : 'visible',
                })
              }
            />
            Keep offscreen tiles connected
          </label>
        </div>
      </details>
      <details className="camera-picker">
        <summary>
          Choose cameras ({workspace.cameraIds.length} selected)
        </summary>
        <div>
          {cameras.map((camera) => (
            <label key={camera.id}>
              <input
                checked={workspace.cameraIds.includes(camera.id)}
                type="checkbox"
                onChange={(event) =>
                  updateWorkspace({
                    cameraIds: event.target.checked
                      ? [...workspace.cameraIds, camera.id]
                      : workspace.cameraIds.filter((id) => id !== camera.id),
                  })
                }
              />
              {camera.name} · {camera.deviceName}
            </label>
          ))}
        </div>
        <p className="notice">
          Reorder tiles by dragging or with the arrow controls. Devices that
          support one active source may interrupt a sibling tile when switched.
        </p>
      </details>

      {selectedCameras.length === 0 ? (
        <p className="empty">
          No cameras match this workspace and filter combination.
        </p>
      ) : (
        <div
          aria-label={`${workspace.name} camera grid`}
          className="monitor-grid"
          data-layout={workspace.layout}
          onDragOver={(event) => event.preventDefault()}
          role="region"
        >
          {selectedCameras.map((camera) => (
            <div
              key={camera.id}
              onDragEnd={() => {
                dragId.current = null;
              }}
              onDragStart={() => {
                dragId.current = camera.id;
              }}
              onDrop={() => {
                if (dragId.current) reorder(dragId.current, camera.id);
              }}
            >
              <MonitorTile
                camera={camera}
                continuous={workspace.refreshPreference === 'continuous'}
                expanded={expandedId === camera.id}
                onDevice={() => onDevice(camera.deviceId)}
                onExpand={() =>
                  setExpandedId((current) =>
                    current === camera.id ? null : camera.id,
                  )
                }
                onMove={(direction) => move(camera.id, direction)}
                onSwitchSource={(cameraId) => {
                  setSwitchError('');
                  void onSwitchSource(cameraId)
                    .then(() => {
                      const next = workspace.cameraIds.map((id) =>
                        id === camera.id ? cameraId : id,
                      );
                      updateWorkspace({
                        cameraIds: next.filter(
                          (id, index) => next.indexOf(id) === index,
                        ),
                      });
                    })
                    .catch(() => {
                      setSwitchError(
                        `Could not switch ${camera.name}. The previous source remains selected.`,
                      );
                    });
                }}
                siblings={cameras.filter(
                  (item) => item.deviceId === camera.deviceId,
                )}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
