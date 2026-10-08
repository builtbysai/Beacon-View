import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defense: an unexpected rendering error shows a way back
 * instead of a blank page. On a camera, that matters doubly -- a blank page
 * gives no hint that capture stopped.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Beacon hit an unexpected error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="shell loading-shell" role="alert">
        <h1>Something went wrong</h1>
        <p>
          Beacon hit an unexpected problem. Reloading usually fixes it; your
          cameras and recordings are not affected.
        </p>
        <div className="error-boundary-actions">
          <button
            className="primary"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload Beacon
          </button>
          <button
            className="secondary"
            onClick={() => window.location.assign('/')}
            type="button"
          >
            Go to Home
          </button>
        </div>
      </main>
    );
  }
}
