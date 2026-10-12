import type { DriveRecording } from './drive-recording';
import { ErrorNotice } from './ErrorNotice';

/** Shown to the owner on every page while Google has stopped accepting the Drive connection (ADR 0116). */
export function DriveExpiredNotice({
  drive,
  onDismiss,
}: {
  drive: Pick<DriveRecording, 'connect' | 'connecting' | 'state'>;
  onDismiss: () => void;
}) {
  if (drive.state !== 'expired') return null;
  return (
    <ErrorNotice
      message="Google Drive disconnected, so new clips can't be saved. Clips already in your Drive are safe. Reconnect to start saving again."
      onDismiss={onDismiss}
      onRetry={drive.connect}
      retryLabel={
        drive.connecting ? 'Waiting for Google…' : 'Reconnect Google Drive'
      }
    />
  );
}
