import { createRoot } from 'react-dom/client';

import { App } from './App';
import { VisualTestHarness } from './VisualTestHarness';
import './styles.css';
import './FinalVisualPass.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) throw new Error('Application root element was not found');

const visualTest =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get('beaconVisual') === 'live';

createRoot(root).render(visualTest ? <VisualTestHarness /> : <App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
