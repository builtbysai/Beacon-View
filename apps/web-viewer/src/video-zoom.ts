import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Zoom and pan for the live view (ADR 0090). The picture is scaled with a CSS
 * transform whose origin is the frame's top-left corner, so a zoom state is
 * just `{ scale, x, y }` and the math below stays small and testable.
 */
export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export interface Frame {
  height: number;
  width: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

/** Keeps the zoomed picture covering the whole frame: no empty margins. */
export function clampZoom(state: ZoomState, frame: Frame): ZoomState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale));
  if (scale === MIN_SCALE) return IDENTITY;
  return {
    scale,
    x: Math.min(0, Math.max(frame.width - scale * frame.width, state.x)),
    y: Math.min(0, Math.max(frame.height - scale * frame.height, state.y)),
  };
}

/** Zooms by `factor` keeping the picture under `point` where it is. */
export function zoomAt(
  state: ZoomState,
  factor: number,
  point: { x: number; y: number },
  frame: Frame,
): ZoomState {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * factor));
  const ratio = scale / state.scale;
  return clampZoom(
    {
      scale,
      x: point.x - (point.x - state.x) * ratio,
      y: point.y - (point.y - state.y) * ratio,
    },
    frame,
  );
}

export function panBy(
  state: ZoomState,
  dx: number,
  dy: number,
  frame: Frame,
): ZoomState {
  if (state.scale === MIN_SCALE) return state;
  return clampZoom({ ...state, x: state.x + dx, y: state.y + dy }, frame);
}

export function isZoomed(state: ZoomState): boolean {
  return state.scale > MIN_SCALE;
}

/** Elements inside the frame that keep their own pointer behavior. */
const INTERACTIVE =
  'button, a, input, select, textarea, [role="dialog"], .video-controls, .video-top-scrim';

export interface VideoZoom {
  state: ZoomState;
  zoomed: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Pan with the keyboard, in frame fractions (e.g. 0.1 = a tenth). */
  nudge: (dx: number, dy: number) => void;
}

/**
 * Wheel and pinch zoom, drag to pan, double-click or double-tap to toggle,
 * all on the video inside `frameRef`. Resets when `resetKey` changes (a
 * different camera).
 */
export function useVideoZoom(
  frameRef: RefObject<HTMLElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  options: { enabled: boolean; resetKey: string },
): VideoZoom {
  const { enabled, resetKey } = options;
  const [state, setState] = useState<ZoomState>(IDENTITY);
  const stateRef = useRef<ZoomState>(IDENTITY);

  const frameSize = useCallback((): Frame | null => {
    const frame = frameRef.current;
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      ? { height: rect.height, width: rect.width }
      : null;
  }, [frameRef]);

  const apply = useCallback(
    (next: ZoomState) => {
      stateRef.current = next;
      setState(next);
      const video = videoRef.current;
      if (!video) return;
      video.style.transformOrigin = '0 0';
      video.style.transform =
        next.scale === MIN_SCALE
          ? ''
          : `translate(${next.x}px, ${next.y}px) scale(${next.scale})`;
    },
    [videoRef],
  );

  useEffect(() => {
    apply(IDENTITY);
  }, [apply, resetKey]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !enabled) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    let lastTap = 0;

    const local = (event: { clientX: number; clientY: number }) => {
      const rect = frame.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const centre = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
    };

    function onWheel(event: WheelEvent) {
      if ((event.target as Element).closest(INTERACTIVE)) return;
      const frameBox = frameSize();
      if (!frameBox) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      apply(zoomAt(stateRef.current, factor, local(event), frameBox));
    }

    function onPointerDown(event: PointerEvent) {
      if ((event.target as Element).closest(INTERACTIVE)) return;
      pointers.set(event.pointerId, local(event));
      if (pointers.size === 2) pinchDistance = distance();
      const now = Date.now();
      if (pointers.size === 1 && now - lastTap < 300) {
        const frameBox = frameSize();
        if (frameBox)
          apply(
            isZoomed(stateRef.current)
              ? IDENTITY
              : zoomAt(IDENTITY, 2.5, local(event), frameBox),
          );
        lastTap = 0;
      } else lastTap = now;
    }

    function onPointerMove(event: PointerEvent) {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const frameBox = frameSize();
      if (!frameBox) return;
      const point = local(event);
      pointers.set(event.pointerId, point);
      if (pointers.size === 2) {
        const next = distance();
        const middle = centre();
        if (pinchDistance > 0 && middle)
          apply(
            zoomAt(stateRef.current, next / pinchDistance, middle, frameBox),
          );
        pinchDistance = next;
      } else if (pointers.size === 1 && isZoomed(stateRef.current)) {
        apply(
          panBy(
            stateRef.current,
            point.x - previous.x,
            point.y - previous.y,
            frameBox,
          ),
        );
      }
    }

    function onPointerEnd(event: PointerEvent) {
      pointers.delete(event.pointerId);
      pinchDistance = 0;
    }

    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerEnd);
    frame.addEventListener('pointercancel', onPointerEnd);
    return () => {
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('pointerdown', onPointerDown);
      frame.removeEventListener('pointermove', onPointerMove);
      frame.removeEventListener('pointerup', onPointerEnd);
      frame.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [apply, enabled, frameRef, frameSize]);

  const step = useCallback(
    (factor: number) => {
      const frameBox = frameSize();
      if (!frameBox) return;
      apply(
        zoomAt(
          stateRef.current,
          factor,
          { x: frameBox.width / 2, y: frameBox.height / 2 },
          frameBox,
        ),
      );
    },
    [apply, frameSize],
  );

  return {
    nudge: (dx, dy) => {
      const frameBox = frameSize();
      if (frameBox)
        apply(
          panBy(
            stateRef.current,
            -dx * frameBox.width,
            -dy * frameBox.height,
            frameBox,
          ),
        );
    },
    reset: () => apply(IDENTITY),
    state,
    zoomIn: () => step(1.4),
    zoomOut: () => step(1 / 1.4),
    zoomed: isZoomed(state),
  };
}
