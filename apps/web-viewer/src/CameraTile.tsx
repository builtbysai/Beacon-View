import { useEffect, useRef, useState } from 'react';
import { cameraStatus, type CameraAvailability } from './camera-status';
import { Icon } from './Icon';
import { LiveVideo } from './LiveVideo';

export interface TileCamera extends CameraAvailability {
  id: string;
  deviceId: string;
  deviceName: string;
  name: string;
  facing: string;
  platform: 'android' | 'browser';
  viewerCount: number;
  lastSeenAt: string | null;
}

function hoverCapable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

/** A calm, static placeholder — this is not a snapshot: Beacon never captures
 * or stores camera images, so the tile shows an icon until a viewer opts in
 * to a live glimpse via hover/tap. */
function CameraGlyph({ privacyMode }: { privacyMode?: boolean | undefined }) {
  return (
    <svg viewBox="0 0 64 48" width="40" height="30" fill="none">
      <rect
        x="8"
        y="10"
        width="36"
        height="28"
        rx="6"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m44 20 12-7v22l-12-7" stroke="currentColor" strokeWidth="2" />
      {privacyMode && (
        <path d="M6 4 58 44" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

export function CameraTile({
  camera,
  highlighted,
  onOpen,
  onDevice,
  onRename,
  onDelete,
}: {
  camera: TileCamera;
  highlighted?: boolean;
  onOpen: (camera: TileCamera) => void;
  onDevice?: (deviceId: string) => void;
  onRename?: (camera: TileCamera) => void;
  onDelete?: (camera: TileCamera) => void;
}) {
  const state = cameraStatus(camera);
  const [previewing, setPreviewing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const canPreview = state.available && hoverCapable();
  const hasMenu = Boolean(onDevice || onRename || onDelete);

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        setMenuOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('keydown', dismissEscape);
    return () => {
      window.removeEventListener('pointerdown', dismissOutside);
      window.removeEventListener('keydown', dismissEscape);
    };
  }, [menuOpen]);

  function startHover() {
    if (!canPreview) return;
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setPreviewing(true), 350);
  }

  function endHover() {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    setPreviewing(false);
  }

  return (
    <article
      className={`camera-tile${highlighted ? ' camera-tile-highlight' : ''}`}
      onPointerEnter={startHover}
      onPointerLeave={endHover}
    >
      <button
        type="button"
        className="camera-tile-open"
        aria-label={`View live: ${camera.name}, ${camera.deviceName}`}
        aria-disabled={!state.available}
        onClick={() => {
          if (state.available) onOpen(camera);
        }}
      >
        <span className="camera-tile-frame">
          {previewing ? (
            <LiveVideo
              camera={camera}
              compact
              enabled
              deviceName={camera.deviceName}
            />
          ) : (
            <span className="camera-tile-placeholder" data-tone={state.tone}>
              <CameraGlyph privacyMode={camera.privacyMode} />
            </span>
          )}
          <span
            className={`camera-tile-status status-badge status-${state.tone}`}
          >
            {state.label}
          </span>
          {camera.viewerCount > 0 && (
            <span className="camera-tile-viewers">
              <Icon name="eye" />
              {camera.viewerCount}
            </span>
          )}
        </span>
        <span className="camera-tile-identity">
          <strong>{camera.name}</strong>
          <span>{camera.deviceName}</span>
        </span>
      </button>
      {hasMenu && (
        <div className="camera-tile-menu-anchor" ref={menuRef}>
          <button
            type="button"
            className="camera-tile-action camera-tile-more"
            aria-label={`${camera.name} options`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <div className="camera-tile-menu" role="menu">
              <button
                role="menuitem"
                type="button"
                disabled={!state.available}
                onClick={() => {
                  setMenuOpen(false);
                  onOpen(camera);
                }}
              >
                <Icon name="eye" />
                Open live view
              </button>
              {onDevice && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDevice(camera.deviceId);
                  }}
                >
                  <Icon name="settings" />
                  Device settings
                </button>
              )}
              {onRename && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onRename(camera);
                  }}
                >
                  <Icon name="edit" />
                  Rename camera
                </button>
              )}
              {onDelete && (
                <button
                  role="menuitem"
                  type="button"
                  className="camera-tile-menu-danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(camera);
                  }}
                >
                  <Icon name="trash" />
                  Delete camera
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
