import { useAppUpdate } from './app-update';
import './UpdateBanner.css';

/** "A new version is ready" for an open page (ADR 0118). Quiet: a small bar, never a dialog. */
export function UpdateBanner() {
  const update = useAppUpdate();
  if (!update.available) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of Beacon is ready.</span>
      <button className="primary" onClick={update.reload} type="button">
        Reload
      </button>
      <button className="quiet" onClick={update.later} type="button">
        Later
      </button>
    </div>
  );
}
