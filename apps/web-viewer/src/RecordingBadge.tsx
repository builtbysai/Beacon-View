import { formatClipTimer } from './recording-capture';
import type { ClipRecorderState } from './useClipRecorder';
import './RecordingBadge.css';

/** Persistent, always-visible status for a manually started clip -- not a
 * hover tooltip, so it reads the same on touch devices as it does with a
 * mouse. Announces each state change once (aria-live="polite" on the
 * container), while the running timer itself stays aria-hidden so a screen
 * reader isn't re-narrated every half second. See docs/decisions for the
 * recording-indicator redesign. */
export function RecordingBadge({ state }: { state: ClipRecorderState }) {
  if (state.status === 'idle') return null;

  const label =
    state.status === 'starting'
      ? 'Starting…'
      : state.status === 'recording'
        ? 'Recording · Manual'
        : state.status === 'uploading'
          ? 'Uploading…'
          : state.status === 'available'
            ? 'Clip saved'
            : 'Recording failed';

  return (
    <div
      className={`recording-badge is-${state.status}`}
      role="status"
      aria-live="polite"
    >
      <span className="recording-badge-dot" aria-hidden="true" />
      <span className="recording-badge-label">{label}</span>
      {state.status === 'recording' && (
        <time className="recording-badge-timer" aria-hidden="true">
          {formatClipTimer(state.elapsedMs)}
        </time>
      )}
    </div>
  );
}
