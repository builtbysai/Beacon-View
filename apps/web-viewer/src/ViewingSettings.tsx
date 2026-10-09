import { loadDataSaver, saveDataSaver, useDataSaver } from './data-saver';
import { SettingsCard, SettingsRow } from './SettingsUI';

/** How this device watches cameras (ADR 0091). Stored on this device. */
export function ViewingSettings() {
  const enabled = useDataSaver();
  return (
    <SettingsCard aria-label="Viewing">
      <SettingsRow
        title="Data saver"
        description="Ask cameras to send less video to this device. The picture is a little softer, and it uses far less mobile data and battery. The camera wall always uses this."
      >
        <button
          aria-checked={enabled}
          aria-label="Data saver"
          className={`camera-settings-switch ${enabled ? 'is-on' : ''}`}
          onClick={() => saveDataSaver(!loadDataSaver())}
          role="switch"
          type="button"
        >
          <span />
        </button>
      </SettingsRow>
    </SettingsCard>
  );
}
