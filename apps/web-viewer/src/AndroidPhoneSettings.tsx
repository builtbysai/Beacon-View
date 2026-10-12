import { useState } from 'react';

import { androidApp } from './android-shell';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingsRow } from './SettingsUI';
import { Switch } from './Switch';
import { useAndroidApp } from './use-android-app';

/** Settings for the phone running the Beacon Android app (ADR 0121): whether it is a camera, pausing it, and
 * stopping it. The camera itself is native (it keeps running with the screen off); this is its remote control. */
export function AndroidPhoneSettings({
  onSetUpCamera,
}: {
  onSetUpCamera: () => void;
}) {
  const { camera } = useAndroidApp();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');

  async function act(action: () => Promise<unknown>, failure: string) {
    setMessage('');
    try {
      await action();
    } catch {
      setMessage(failure);
    }
  }

  if (!camera) return <p className="settings-card-inline-message">Loading…</p>;

  if (!camera.paired)
    return (
      <div className="desktop-computer-settings">
        <SettingsRow
          title="This phone is not a camera"
          description="Use it as a camera to watch a room from your other devices. Beacon always shows when the camera is on."
        >
          <button className="primary" onClick={onSetUpCamera} type="button">
            Set up this phone as a camera
          </button>
        </SettingsRow>
      </div>
    );

  return (
    <div className="desktop-computer-settings">
      <SettingsRow
        title={camera.deviceName}
        description={
          camera.privacy
            ? 'Paused. The camera and microphone are off.'
            : camera.running
              ? camera.viewers > 0
                ? `Live. ${camera.viewers} ${camera.viewers === 1 ? 'person is' : 'people are'} watching.`
                : camera.online
                  ? 'Ready. Cameras start when someone opens the live view.'
                  : 'Connecting to Beacon…'
              : 'The camera is not running.'
        }
      >
        <button
          className="secondary"
          onClick={() =>
            void act(
              androidApp.openCameraScreen,
              'The camera screen could not be opened.',
            )
          }
          type="button"
        >
          Open camera screen
        </button>
      </SettingsRow>
      <SettingsRow
        title="Pause this camera"
        description="Privacy mode stops the camera and microphone on this phone immediately. Turn it off to resume."
      >
        <Switch
          checked={camera.privacy}
          label="Pause this camera"
          onChange={(next) =>
            void act(
              () => androidApp.setPrivacy(next),
              'The camera could not be paused.',
            )
          }
        />
      </SettingsRow>
      <SettingsRow
        title="Stop using this phone as a camera"
        description="Removes this phone from your household's cameras. You can set it up again at any time."
        tone="danger"
      >
        <button
          className="danger"
          onClick={() => setConfirming(true)}
          type="button"
        >
          Stop being a camera
        </button>
      </SettingsRow>
      {message && (
        <p role="status" className="settings-card-inline-message">
          {message}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="Stop using this phone as a camera?"
          description="The camera stops and this phone is removed from your cameras. Nothing is deleted from your account."
          confirmLabel="Stop being a camera"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void act(
              androidApp.disconnectCamera,
              'The camera could not be stopped.',
            );
          }}
        />
      )}
    </div>
  );
}
