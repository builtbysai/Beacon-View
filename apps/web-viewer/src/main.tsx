import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';
import './FinalVisualPass.css';

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) throw new Error('Application root element was not found');

createRoot(root).render(<App />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
