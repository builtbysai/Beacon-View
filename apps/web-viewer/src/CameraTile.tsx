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
  onInfo,
  onDevice,
}: {
  camera: TileCamera;
  highlighted?: boolean;
  onOpen: (camera: TileCamera) => void;
  onInfo?: (camera: TileCamera) => void;
  onDevice?: (deviceId: string) => void;
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
      <span className="camera-tile-actions">
        {onInfo && (
          <button
            type="button"
            className="camera-tile-action"
            aria-label={`${camera.name} details`}
            onClick={() => onInfo(camera)}
          >
            <Icon name="info" />
          </button>
        )}
        {onDevice && (
          <button
            type="button"
            className="camera-tile-action"
            aria-label={`${camera.name} settings`}
            onClick={() => onDevice(camera.deviceId)}
          >
            <Icon name="settings" />
          </button>
        )}
      </span>
    </article>
  );
}
