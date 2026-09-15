import { useState } from 'react';

import { cameraStatus } from './camera-status';
import { CameraFlipButton } from './CameraFlipButton';
import type { Camera, Device } from './domain';
import { Icon } from './Icon';
import { InlineRename } from './InlineRename';
import { ModalDialog } from './ModalDialog';

export function LiveCameraSettingsDialog({
  camera,
  device,
  sources,
  onDismiss,
  onPrivacy,
  onRename,
  onSwitch,
}: {
  camera: Camera;
  device: Device;
  sources: Camera[];
  onDismiss: () => void;
  onPrivacy: () => Promise<void>;
  onRename: (name: string) => void;
  onSwitch: (camera: Camera) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState('');
  const state = cameraStatus(camera);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setControlError('');
    try {
      await action();
    } catch (caught) {
      setControlError(
        caught instanceof Error
          ? caught.message
          : 'The change could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalDialog labelledBy="live-camera-settings-title" onDismiss={onDismiss}>
      <section className="live-camera-settings">
        <div className="live-camera-settings-header">
          <div>
            <span>Camera settings</span>
            {renaming ? (
              <InlineRename
                value={device.name}
                ariaLabel="Rename this camera"
                className="inline-rename-heading"
                explicitActions
                onSubmit={(name) => {
                  setRenaming(false);
                  onRename(name);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <h2 id="live-camera-settings-title">{device.name}</h2>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close camera settings"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="live-camera-setting-row">
          <span className={`status-badge status-${state.tone}`}>
            {state.label}
          </span>
          {!renaming && (
            <button
              type="button"
              className="secondary compact-button"
              onClick={() => setRenaming(true)}
            >
              <Icon name="edit" />
              Rename
            </button>
          )}
        </div>
        {sources.length > 1 && (
          <div className="live-camera-setting-row">
            <div>
              <strong>{camera.name}</strong>
              <span>Active camera</span>
            </div>
            <CameraFlipButton
              sources={sources}
              activeId={camera.id}
              busy={busy || Boolean(device.privacyMode)}
              onSwitch={(id) => {
                const target = sources.find((source) => source.id === id);
                if (target) void run(() => onSwitch(target));
              }}
            />
          </div>
        )}
        {device.platform === 'android' && (
          <button
            type="button"
            className={device.privacyMode ? '' : 'secondary'}
            disabled={busy}
            onClick={() => void run(onPrivacy)}
          >
            <Icon name={device.privacyMode ? 'camera' : 'lock'} />
            {device.privacyMode ? 'Resume' : 'Pause'}
          </button>
        )}
        {controlError && <p role="alert">{controlError}</p>}
      </section>
    </ModalDialog>
  );
}
