import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { finishDriveConnectPopup } from './drive-recording';
import { VisualTestHarness } from './VisualTestHarness';
import './styles.css';
import './FinalVisualPass.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) throw new Error('Application root element was not found');

const visualTest =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('beaconVisual') === 'live';

// Google's Drive consent opened in a popup over a live view: report back to
// that page and close, rather than loading a second copy of the app.
if (!finishDriveConnectPopup())
  createRoot(root).render(
    visualTest ? (
      <VisualTestHarness />
    ) : (
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    ),
  );

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
