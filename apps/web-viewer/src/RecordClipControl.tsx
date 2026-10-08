import { useEffect, useRef } from 'react';

import './RecordClipControl.css';

import { type DriveRecording, isDriveProblem } from './drive-recording';
import { Icon } from './Icon';
import { formatClipTimer } from './recording-capture';
import type { useClipRecorder } from './useClipRecorder';

type Clip = ReturnType<typeof useClipRecorder>;

/** The record button for the live view and Camera Mode. When Drive can't
 * take recordings it becomes "Connect" / "Reconnect Google Drive to record",
 * which opens Google's consent without leaving the page. */
export function RecordClipControl({
  className,
  clip,
  disabled = false,
  drive,
  onStart,
}: {
  className: string;
  clip: Clip;
  /** Extra reasons the button can't be used right now (paused, offline). */
  disabled?: boolean;
  drive: DriveRecording;
  onStart: () => void;
}) {
  const { status } = clip.state;
  const busy = status === 'recording' || status === 'uploading';
  const driveBlocked =
    (drive.state === 'not_connected' || drive.state === 'expired') &&
    !busy &&
    !clip.hasPendingUpload;
  if (drive.state === 'unavailable' || !clip.supported) return null;

  if (driveBlocked) {
    const label =
      drive.state === 'expired'
        ? 'Reconnect Google Drive to record'
        : 'Connect Google Drive to record';
    return (
      <button
        className={className}
        disabled={drive.connecting}
        onClick={drive.connect}
        title={drive.connecting ? 'Waiting for Google Drive…' : label}
        type="button"
      >
        <Icon name="record" />
        <span className="visually-hidden">{label}</span>
      </button>
    );
  }

  return (
    <button
      aria-pressed={status === 'recording'}
      className={`${className}${status === 'recording' ? ' is-active' : ''}`}
      title={
        status === 'recording'
          ? 'Tap to stop recording'
          : status === 'failed'
            ? 'Retry encrypted upload'
            : 'Record a short clip'
      }
      disabled={
        (disabled && status !== 'recording') ||
        status === 'starting' ||
        status === 'uploading' ||
        status === 'available'
      }
      onClick={
        status === 'recording'
          ? clip.stop
          : status === 'failed' && clip.hasPendingUpload
            ? clip.retry
            : () => {
                if (status === 'failed') clip.reset();
                onStart();
              }
      }
      type="button"
    >
      <Icon name="record" />
      <span className="visually-hidden">
        {status === 'starting'
          ? 'Starting recording…'
          : status === 'recording'
            ? `Recording, ${formatClipTimer(clip.state.elapsedMs)} elapsed. Tap to stop.`
            : status === 'uploading'
              ? 'Uploading recording'
              : status === 'available'
                ? 'Recording saved'
                : status === 'failed' && clip.hasPendingUpload
                  ? 'Retry encrypted recording upload'
                  : 'Record a short clip'}
      </span>
    </button>
  );
}

/**
 * Explains a recording that Drive refused, and fixes it in place:
 * - before recording: "Reconnect Google Drive to record"
 * - after recording: the clip stays on this device and uploads by itself
 *   once Drive is reconnected (nothing is lost).
 */
export function DriveReconnectNotice({
  className,
  clip,
  drive,
}: {
  className: string;
  clip: Clip;
  drive: DriveRecording;
}) {
  const failedOnDrive =
    clip.state.status === 'failed' && isDriveProblem(clip.state.errorCode);
  useClipDriveRecovery(clip, drive);
  if (!failedOnDrive) return null;

  const expired = clip.state.errorCode === 'drive_reconnect_required';
  return (
    <div className={`drive-reconnect-notice ${className}`} role="alert">
      <p>
        <strong>
          {expired
            ? 'Google Drive disconnected.'
            : 'Google Drive isn’t connected.'}
        </strong>{' '}
        {clip.hasPendingUpload
          ? 'Your clip is kept on this device and uploads as soon as Drive is connected.'
          : 'Connect it to save recordings.'}
      </p>
      {drive.connectError && <p>{drive.connectError}</p>}
      <div className="drive-reconnect-actions">
        <button
          className="primary"
          disabled={drive.connecting}
          onClick={drive.connect}
          type="button"
        >
          {drive.connecting
            ? 'Waiting for Google Drive…'
            : expired
              ? 'Reconnect Google Drive'
              : 'Connect Google Drive'}
        </button>
        <button className="link" onClick={clip.reset} type="button">
          {clip.hasPendingUpload ? 'Discard clip' : 'Dismiss'}
        </button>
      </div>
      {drive.connecting && (
        <p className="drive-reconnect-hint">
          Finish in the Google window that opened. This page updates by itself.
        </p>
      )}
    </div>
  );
}

/** Tells the Drive tracker when a recording hit a Drive problem, and
 * uploads a held clip by itself once Drive is ready again. */
function useClipDriveRecovery(clip: Clip, drive: DriveRecording): void {
  const { errorCode, status } = clip.state;
  const failedOnDrive = status === 'failed' && isDriveProblem(errorCode);
  const { report } = drive;
  useEffect(() => {
    if (failedOnDrive) report(errorCode);
  }, [errorCode, failedOnDrive, report]);

  // Retry once per reconnect: only when Drive turns ready after the failure.
  const sawBlocked = useRef(false);
  useEffect(() => {
    if (!failedOnDrive) {
      sawBlocked.current = false;
      return;
    }
    if (drive.state !== 'ready') {
      sawBlocked.current = true;
      return;
    }
    if (!sawBlocked.current) return;
    sawBlocked.current = false;
    if (clip.hasPendingUpload) clip.retry();
    else clip.reset();
  }, [clip, drive.state, failedOnDrive]);
}
