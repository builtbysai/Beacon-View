import {
  type CSSProperties,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { friendlyError } from './friendly-errors';
import {
  type CameraMotionSettings,
  cellAtPoint,
  cellsBetween,
  describeZones,
  loadMotionSettings,
  paintCells,
  pictureRect,
  type Rect,
  saveZones,
  ZONE_COUNT,
  ZONE_GRID_SIZE,
} from './motion-zones';
import './MotionZoneEditor.css';

/**
 * Draw the areas where movement should be ignored (ADR 0092), right on the
 * live picture. Touch or drag to paint cells; drag over painted cells to
 * erase. Saving keeps every other motion setting as it is.
 */
export function MotionZoneEditor({
  cameraId,
  deviceId,
  frameRef,
  onClose,
  videoRef,
}: {
  cameraId: string;
  deviceId: string;
  frameRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [settings, setSettings] = useState<CameraMotionSettings | null>(null);
  const [zones, setZones] = useState<ReadonlySet<number>>(new Set());
  const [saved, setSaved] = useState<ReadonlySet<number>>(new Set());
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [picture, setPicture] = useState<Rect>({
    height: 0,
    left: 0,
    top: 0,
    width: 0,
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    ignore: boolean;
    last: { x: number; y: number };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMotionSettings(deviceId, cameraId).then(
      (loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setLoadError(
            'This camera’s motion settings aren’t available. Only Android cameras detect motion.',
          );
          return;
        }
        setSettings(loaded);
        const current = new Set(loaded.ignoredZones ?? []);
        setZones(current);
        setSaved(current);
      },
      (error: unknown) => {
        if (!cancelled)
          setLoadError(
            friendlyError(
              error,
              'The motion settings couldn’t be loaded. Try again.',
            ),
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cameraId, deviceId]);

  // The grid covers the picture itself, not the black bars around it.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const box = frame.getBoundingClientRect();
      const video = videoRef.current;
      setPicture(
        pictureRect(
          { height: box.height, width: box.width },
          { height: video?.videoHeight ?? 0, width: video?.videoWidth ?? 0 },
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    videoRef.current?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      videoRef.current?.removeEventListener('resize', measure);
    };
  }, [frameRef, videoRef]);

  function point(event: PointerEvent): { x: number; y: number } {
    const box = gridRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (box?.left ?? 0) - picture.left,
      y: event.clientY - (box?.top ?? 0) - picture.top,
    };
  }
  const local: Rect = { ...picture, left: 0, top: 0 };

  function onPointerDown(event: PointerEvent) {
    const start = point(event);
    const cell = cellAtPoint(start.x, start.y, local);
    if (cell === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Starting on a painted cell erases; starting on a clear one paints.
    const ignore = !zones.has(cell);
    drag.current = { ignore, last: start };
    setZones((current) => paintCells(current, [cell], ignore));
    setSaveError('');
  }

  function onPointerMove(event: PointerEvent) {
    const active = drag.current;
    if (!active) return;
    const next = point(event);
    const cells = cellsBetween(active.last, next, local);
    active.last = next;
    if (cells.length > 0)
      setZones((current) => paintCells(current, cells, active.ignore));
  }

  function onPointerEnd() {
    drag.current = null;
  }

  const changed =
    zones.size !== saved.size || [...zones].some((cell) => !saved.has(cell));

  async function save() {
    if (!settings) return;
    setSaving(true);
    setSaveError('');
    try {
      const stored = await saveZones(settings, zones);
      const next = new Set(stored);
      setZones(next);
      setSaved(next);
      onClose();
    } catch (error) {
      setSaveError(
        friendlyError(error, 'The areas couldn’t be saved. Try again.'),
      );
    } finally {
      setSaving(false);
    }
  }

  const cells = Array.from({ length: ZONE_COUNT }, (_, index) => index);
  return (
    <div
      className="zone-editor"
      data-keyboard-busy="true"
      role="group"
      aria-label="Choose areas to ignore"
    >
      <div
        className="zone-grid"
        onPointerCancel={onPointerEnd}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        ref={gridRef}
        style={
          {
            '--zone-height': `${picture.height}px`,
            '--zone-left': `${picture.left}px`,
            '--zone-size': ZONE_GRID_SIZE,
            '--zone-top': `${picture.top}px`,
            '--zone-width': `${picture.width}px`,
          } as CSSProperties
        }
      >
        {cells.map((cell) => (
          <span
            className={`zone-cell${zones.has(cell) ? ' is-ignored' : ''}`}
            data-cell={cell}
            key={cell}
          />
        ))}
      </div>
      <div className="zone-panel">
        <p className="zone-help">
          {loadError ||
            'Touch or drag over the picture to ignore movement there. Drag over painted areas to bring them back.'}
        </p>
        <p aria-live="polite" className="zone-count">
          {describeZones(zones.size)}
        </p>
        {saveError && (
          <p className="zone-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="zone-actions">
          <button
            className="secondary"
            disabled={zones.size === 0 || saving}
            onClick={() => setZones(new Set())}
            type="button"
          >
            Clear all
          </button>
          <button
            className="secondary"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            {changed ? 'Cancel' : 'Close'}
          </button>
          <button
            className="primary"
            disabled={!settings || !changed || saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
