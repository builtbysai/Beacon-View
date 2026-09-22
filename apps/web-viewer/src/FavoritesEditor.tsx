import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import type { Camera } from './domain';

/** Favorites are a per-browser preference (see favorites.ts) -- this picker
 * just toggles which host devices are in that local list. */
export function FavoritesEditor({
  cameras,
  favoriteDeviceIds,
  onToggle,
  onDismiss,
}: {
  cameras: Camera[];
  favoriteDeviceIds: string[];
  onToggle: (deviceId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <ModalDialog labelledBy="favorites-editor-title" onDismiss={onDismiss}>
      <div className="favorites-editor">
        <div className="favorites-editor-header">
          <div>
            <h2 id="favorites-editor-title">Edit Favorites</h2>
            <p>Choose the cameras you want quick access to from Home.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>
        <ul className="favorites-editor-list">
          {cameras.map((camera) => {
            const checked = favoriteDeviceIds.includes(camera.deviceId);
            return (
              <li key={camera.deviceId}>
                <label className="favorites-editor-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(camera.deviceId)}
                  />
                  <span>{camera.deviceName}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="confirm-modal-actions">
          <button type="button" className="primary" onClick={onDismiss}>
            Done
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
