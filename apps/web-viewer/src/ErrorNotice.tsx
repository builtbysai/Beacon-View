import { Icon } from './Icon';

/** The standard way to show that something didn't work (ADR 0087): what
 * happened in plain words, a way to try again when that makes sense, and a
 * way to dismiss it. */
export function ErrorNotice({
  message,
  onDismiss,
  onRetry,
  retryLabel = 'Try again',
}: {
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="error-notice" role="alert">
      <Icon name="alert" />
      <p>{message}</p>
      {(onRetry || onDismiss) && (
        <div className="error-notice-actions">
          {onRetry && (
            <button className="secondary" onClick={onRetry} type="button">
              {retryLabel}
            </button>
          )}
          {onDismiss && (
            <button
              aria-label="Dismiss"
              className="error-notice-dismiss"
              onClick={onDismiss}
              title="Dismiss"
              type="button"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
