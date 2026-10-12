import { useEffect, useRef, useState } from 'react';
import { cameraStatus } from './camera-status';
import type { TileCamera } from './CameraTile';
import { relativeLastSeen } from './device-presentation';
import { Icon } from './Icon';
import { LiveVideo } from './LiveVideo';
import { OverflowMenu } from './OverflowMenu';
import './FavoriteCameraCard.css';

function hoverCapable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

function CameraGlyph({ privacyMode }: { privacyMode?: boolean | undefined }) {
  return (
    <svg viewBox="0 0 64 48" width="46" height="34" fill="none">
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

/** Home's entry point into a favorited camera's live view -- a larger,
 * calmer surface than the Devices grid's management-oriented tile. It
 * reuses the same hover-preview and status logic as CameraTile, just laid
 * out for "glance and open," not "manage." */
export function FavoriteCameraCard({
  camera,
  needsPairing,
  canReconnect,
  onOpen,
  onDevice,
  onReconnect,
  onRemoveFavorite,
  onContinueCamera,
}: {
  camera: TileCamera;
  needsPairing: boolean;
  canReconnect: boolean;
  onOpen: (camera: TileCamera) => void;
  onDevice: (deviceId: string) => void;
  onReconnect: (deviceId: string) => void;
  onRemoveFavorite: (deviceId: string) => void;
  onContinueCamera?: () => void;
}) {
  const state = cameraStatus(camera);
  const [previewing, setPreviewing] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const canPreview = state.available && hoverCapable();

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

  const statusLine = state.available
    ? 'Ready to view'
    : state.label === 'Privacy on'
      ? 'Privacy on'
      : onContinueCamera
        ? 'Camera stopped here'
        : needsPairing
          ? 'Needs pairing'
          : 'Reconnect required';

  return (
    <article
      className="favorite-card"
      onPointerEnter={startHover}
      onPointerLeave={endHover}
    >
      <button
        type="button"
        className="favorite-card-surface"
        aria-label={`${state.label}. View live: ${camera.deviceName}`}
        disabled={!state.available}
        aria-disabled={!state.available}
        onClick={() => {
          if (state.available) onOpen(camera);
        }}
      >
        <span className="favorite-card-frame">
          {previewing ? (
            <LiveVideo
              camera={camera}
              compact
              enabled
              deviceName={camera.deviceName}
            />
          ) : (
            <span className="favorite-card-placeholder" data-tone={state.tone}>
              <CameraGlyph privacyMode={camera.privacyMode} />
            </span>
          )}
          <span className={`favorite-card-badge status-${state.tone}`}>
            {state.label}
          </span>
          {camera.viewerCount > 0 && (
            <span className="favorite-card-viewers" aria-hidden="true">
              <Icon name="eye" />
              {camera.viewerCount}
            </span>
          )}
        </span>
      </button>

      <div className="favorite-card-body">
        <div className="favorite-card-headline">
          <strong>{camera.deviceName}</strong>
          {camera.lastSeenAt && (
            <time dateTime={camera.lastSeenAt}>
              {relativeLastSeen(camera.lastSeenAt)}
            </time>
          )}
        </div>
        <p className="favorite-card-sub">
          {camera.platform === 'android' ? 'Android device' : 'Browser'}
          {camera.name ? ` · ${camera.name}` : ''}
        </p>
        <div className="favorite-card-footer">
          <span
            className={
              state.available || state.label === 'Privacy on'
                ? 'favorite-card-signal'
                : 'favorite-card-signal favorite-card-signal-warn'
            }
          >
            <i />
            {statusLine}
          </span>
          <button
            type="button"
            className="favorite-card-cta"
            onClick={() => {
              if (state.available) onOpen(camera);
              else if (onContinueCamera) onContinueCamera();
              else if (canReconnect) onReconnect(camera.deviceId);
              else onDevice(camera.deviceId);
            }}
          >
            {state.available
              ? 'Open live'
              : onContinueCamera
                ? 'Resume camera'
                : 'Review'}
            <Icon name="chevronRight" />
          </button>
        </div>
      </div>

      <OverflowMenu
        anchorClassName="favorite-card-menu-anchor"
        label={`${camera.deviceName} options`}
      >
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
            {canReconnect && (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  close();
                  onReconnect(camera.deviceId);
                }}
              >
                <Icon name="refresh" />
                Reconnect camera
              </button>
            )}
            {onContinueCamera && (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  close();
                  onContinueCamera();
                }}
              >
                <Icon name="camera" /> Continue as camera
              </button>
            )}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                close();
                onRemoveFavorite(camera.deviceId);
              }}
            >
              <Icon name="close" />
              Remove from Favorites
            </button>
          </>
        )}
      </OverflowMenu>
    </article>
  );
}
