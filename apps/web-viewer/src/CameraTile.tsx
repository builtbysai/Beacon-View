import { useEffect, useRef, useState } from 'react';
import { cameraStatus, type CameraAvailability } from './camera-status';
import { Icon } from './Icon';
import { InlineRename } from './InlineRename';
import { LiveVideo } from './LiveVideo';
import { OverflowMenu } from './OverflowMenu';
import './CameraTile.css';

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
  groupedByHost?: boolean;
  onOpen: (camera: TileCamera) => void;
  onDevice?: (deviceId: string) => void;
  onReconnect?: (camera: TileCamera) => void;
  onRename?: (camera: TileCamera, name: string) => void;
  onDelete?: (camera: TileCamera) => void;
  onLeave?: (camera: TileCamera) => void;
}) {
  const state = cameraStatus(camera);
  const [previewing, setPreviewing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const canPreview = state.available && hoverCapable();
  const showRemove = Boolean(onDelete && camera.canRemove);
  const showLeave = Boolean(onLeave && camera.canLeave && !camera.canRemove);
  const hasMenu = Boolean(onDevice || onReconnect || onRename || showRemove || showLeave);
  const primaryName = groupedByHost ? camera.deviceName : camera.name;
  const secondaryStatus = state.available
    ? 'Online · ready to view'
    : state.label === 'Privacy on'
      ? 'Online · privacy on'
      : 'Offline · reconnect required';

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
        disabled={!state.available}
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
            <span
              className="camera-tile-placeholder"
              data-tone={state.tone}
              aria-hidden="true"
            />
          )}
          <span className={`camera-tile-status status-badge status-${state.tone}`}>
            {state.label}
          </span>
          {camera.viewerCount > 0 && (
            <span className="camera-tile-viewers">
              <Icon name="eye" />
              {camera.viewerCount}
            </span>
          )}
        </span>
      </button>

      <div className="camera-tile-footer">
        <div
          className="camera-tile-identity-wrapper"
          onClick={() => {
            if (state.available && !renaming) onOpen(camera);
          }}
        >
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
              <strong
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (onRename) setRenaming(true);
                }}
              >
                {primaryName}
              </strong>
            )}
            <span className="camera-tile-secondary-status">
              {camera.platform === 'android' ? 'Android device' : 'Browser'} · {secondaryStatus}
            </span>
          </span>
        </div>

        {hasMenu && (
          <OverflowMenu anchorClassName="overflow-menu-container" label={`${primaryName} options`}>
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
      </div>
    </article>
  );
}
