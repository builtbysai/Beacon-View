import { useEffect, useRef, useState } from 'react';
import { cameraStatus, type CameraAvailability } from './camera-status';
import { Icon } from './Icon';
import { InlineRename } from './InlineRename';
import { LiveVideo } from './LiveVideo';
import { OverflowMenu } from './OverflowMenu';

export interface TileCamera extends CameraAvailability {
  id: string;
  deviceId: string;
  deviceName: string;
  name: string;
  facing: string;
  platform: 'android' | 'browser';
  viewerCount: number;
  lastSeenAt: string | null;
  canRemove?: boolean;
  canLeave?: boolean;
}

function hoverCapable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

/** A calm, static placeholder. This is not a snapshot: Beacon never captures
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
  groupedByHost = false,
  onOpen,
  onDevice,
  onReconnect,
  onRename,
  onDelete,
  onLeave,
}: {
  camera: TileCamera;
  highlighted?: boolean;
  /** True when this tile represents a whole host device (Home/Cameras grid)
   * rather than one specific source (CameraSettings' source list) — the
   * device name is the primary identity, and rename/remove act on the
   * device rather than just the active source. */
  groupedByHost?: boolean;
  onOpen: (camera: TileCamera) => void;
  onDevice?: (deviceId: string) => void;
  onReconnect?: (camera: TileCamera) => void;
  onRename?: (camera: TileCamera, name: string) => void;
  /** Only rendered when this camera's own `canRemove` says the viewer
   * paired it themselves (or is an owner/admin) -- otherwise a click would
   * just dead-end in a 403 from the backend. */
  onDelete?: (camera: TileCamera) => void;
  /** Drops the viewer's own access to a camera someone else shared with
   * them; only rendered when `canLeave` is true and `canRemove` isn't
   * (removing already covers "make this camera go away for me and then
   * some" for whoever paired it). */
  onLeave?: (camera: TileCamera) => void;
}) {
  const state = cameraStatus(camera);
  const [previewing, setPreviewing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const canPreview = state.available && hoverCapable();
  const showRemove = Boolean(onDelete && camera.canRemove);
  const showLeave = Boolean(onLeave && camera.canLeave && !camera.canRemove);
  const hasMenu = Boolean(
    onDevice || onReconnect || onRename || showRemove || showLeave,
  );
  const primaryName = groupedByHost ? camera.deviceName : camera.name;

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

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
        aria-label={`View live: ${primaryName}`}
        aria-disabled={!state.available}
        onClick={() => {
          if (state.available && !renaming) onOpen(camera);
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
          {renaming ? (
            <InlineRename
              value={primaryName}
              ariaLabel={`Rename ${primaryName}`}
              onSubmit={(name) => {
                setRenaming(false);
                onRename?.(camera, name);
              }}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <strong>{primaryName}</strong>
          )}
          {!groupedByHost && <span>{camera.deviceName}</span>}
        </span>
      </button>
      {hasMenu && (
        <OverflowMenu label={`${primaryName} options`}>
          {(close) => (
            <>
              <button
                role="menuitem"
                type="button"
                disabled={!state.available}
                onClick={() => {
                  close();
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
                    close();
                    onDevice(camera.deviceId);
                  }}
                >
                  <Icon name="settings" />
                  Camera settings
                </button>
              )}
              {onReconnect && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    close();
                    onReconnect(camera);
                  }}
                >
                  <Icon name="refresh" />
                  Reconnect camera
                </button>
              )}
              {onRename && (
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    close();
                    setRenaming(true);
                  }}
                >
                  <Icon name="edit" />
                  Rename
                </button>
              )}
              {showRemove && (
                <button
                  role="menuitem"
                  type="button"
                  className="camera-tile-menu-danger"
                  onClick={() => {
                    close();
                    onDelete!(camera);
                  }}
                >
                  <Icon name="trash" />
                  Remove camera
                </button>
              )}
              {showLeave && (
                <button
                  role="menuitem"
                  type="button"
                  className="camera-tile-menu-danger"
                  onClick={() => {
                    close();
                    onLeave!(camera);
                  }}
                >
                  <Icon name="eyeOff" />
                  Leave this camera
                </button>
              )}
            </>
          )}
        </OverflowMenu>
      )}
    </article>
  );
}
