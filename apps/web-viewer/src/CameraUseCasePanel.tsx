import { useState } from 'react';

import { request } from './api';
import {
  CAMERA_USE_CASES,
  type CameraUseCase,
  cameraUseCase,
} from './camera-use-case';
import type { Camera } from './domain';

/** "What is this camera for?" (ADR 0084). Choosing a use case applies its
 * preset on the server; Android cameras get matching motion settings. */
export function CameraUseCasePanel({
  cameras,
  onApplied,
}: {
  cameras: Camera[];
  onApplied: () => void;
}) {
  return (
    <section className="camera-settings-group">
      <div className="camera-settings-group-head">
        <div>
          <h3>What it’s for</h3>
          <p>A starting point for alerts, clips, and sound.</p>
        </div>
      </div>
      {cameras.map((camera) => (
        <CameraUseCaseField
          camera={camera}
          key={camera.id}
          label={cameras.length > 1 ? camera.name : 'This camera'}
          onApplied={onApplied}
        />
      ))}
    </section>
  );
}

function CameraUseCaseField({
  camera,
  label,
  onApplied,
}: {
  camera: Camera;
  label: string;
  onApplied: () => void;
}) {
  const [value, setValue] = useState<CameraUseCase>(
    cameraUseCase(camera.useCase).id,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const selectId = `use-case-${camera.id}`;
  const info = cameraUseCase(value);

  async function choose(next: CameraUseCase) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setMessage('');
    try {
      const result = await request<{ motionPresetApplied: boolean }>(
        `/api/cameras/${encodeURIComponent(camera.id)}/use-case`,
        { body: JSON.stringify({ useCase: next }), method: 'PUT' },
      );
      setMessage(
        result.motionPresetApplied
          ? 'Saved. Motion settings below were updated to match.'
          : camera.platform === 'android'
            ? 'Saved.'
            : 'Saved. Standby and sound are set in Camera Mode on that computer.',
      );
      onApplied();
    } catch {
      setValue(previous);
      setMessage('Couldn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="local-field full camera-use-case-field">
      <label htmlFor={selectId}>{label}</label>
      <select
        disabled={busy}
        id={selectId}
        onChange={(event) => void choose(event.target.value as CameraUseCase)}
        value={value}
      >
        {CAMERA_USE_CASES.map((useCase) => (
          <option key={useCase.id} value={useCase.id}>
            {useCase.label}
          </option>
        ))}
      </select>
      <p className="local-hint">
        {camera.platform === 'android' ? info.android : info.computer}
      </p>
      {message && (
        <p className="local-hint" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
