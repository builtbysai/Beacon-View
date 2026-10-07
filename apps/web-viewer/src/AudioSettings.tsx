import { useEffect, useState } from 'react';

import { SettingsCard, SettingsField, SettingsFieldRow } from './SettingsUI';
import {
  listMicrophones,
  loadTalkMicrophone,
  type Microphone,
  saveTalkMicrophone,
} from './talk-microphone';

/** Which microphone this device uses when you Talk through a camera. A
 * camera's own microphone is chosen in Camera Mode on that camera. */
export function AudioSettings() {
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [selected, setSelected] = useState(loadTalkMicrophone);
  const [named, setNamed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void listMicrophones(false)
      .then((devices) => {
        setMicrophones(devices);
        // Labels only appear once permission was granted before.
        setNamed(
          devices.some((device) => !/^Microphone \d+$/.test(device.label)),
        );
      })
      .catch(() => setMicrophones([]));
  }, []);

  async function showNames() {
    setError('');
    try {
      setMicrophones(await listMicrophones(true));
      setNamed(true);
    } catch {
      setError(
        'Microphone access was denied. Allow it in your browser or system settings.',
      );
    }
  }

  return (
    <SettingsCard aria-label="Audio">
      <SettingsFieldRow
        label="Microphone for Talk"
        description="Used when you talk through a camera from this device. A computer camera’s own microphone is chosen in Camera Mode."
      >
        <SettingsField label="Microphone" htmlFor="talk-microphone" grow>
          <select
            className="input-field"
            id="talk-microphone"
            onChange={(event) => {
              setSelected(event.target.value);
              saveTalkMicrophone(event.target.value);
            }}
            value={
              microphones.some((device) => device.deviceId === selected)
                ? selected
                : ''
            }
          >
            <option value="">System default</option>
            {microphones.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </SettingsField>
        {!named && microphones.length > 0 && (
          <button
            className="secondary"
            onClick={() => void showNames()}
            type="button"
          >
            Show names
          </button>
        )}
      </SettingsFieldRow>
      {error && (
        <p className="settings-card-inline-message" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
