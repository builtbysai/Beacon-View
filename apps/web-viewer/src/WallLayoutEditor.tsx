import { useState } from 'react';
import type { Camera } from './domain';
import {
  MAX_LAYOUT_CAMERAS,
  type WallLayout,
  type WallColumns,
} from './wall-layouts';

export function WallLayoutEditor({
  cameras,
  initial,
  onSave,
  onCancel,
}: {
  cameras: Camera[];
  initial: WallLayout;
  onSave: (layout: WallLayout) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [ids, setIds] = useState(
    initial.deviceIds.filter((id) =>
      cameras.some((camera) => camera.deviceId === id),
    ),
  );
  const [columns, setColumns] = useState<WallColumns>(initial.columns);
  const ordered = ids.flatMap((id) =>
    cameras.filter((camera) => camera.deviceId === id),
  );
  function move(index: number, delta: number) {
    const next = [...ids];
    [next[index], next[index + delta]] = [next[index + delta]!, next[index]!];
    setIds(next);
  }
  return (
    <form
      className="wall-layout-editor"
      aria-label="Edit camera group and layout"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && ids.length)
          onSave({ name: name.trim(), deviceIds: ids, columns });
      }}
    >
      <h2>Camera group and layout</h2>
      <p>
        Saved on this browser for this account and household. Choose up to nine
        cameras.
      </p>
      <label>
        Layout name
        <input
          className="input-field"
          maxLength={60}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Layout columns
        <select
          className="input-field"
          value={String(columns)}
          onChange={(event) =>
            setColumns(
              event.target.value === 'auto'
                ? 'auto'
                : (Number(event.target.value) as 1 | 2 | 3),
            )
          }
        >
          <option value="auto">Auto layout</option>
          <option value="1">1 column</option>
          <option value="2">2 columns</option>
          <option value="3">3 columns</option>
        </select>
      </label>
      <fieldset>
        <legend>Cameras</legend>
        {cameras.map((camera) => (
          <label key={camera.deviceId}>
            <input
              type="checkbox"
              checked={ids.includes(camera.deviceId)}
              disabled={
                !ids.includes(camera.deviceId) &&
                ids.length >= MAX_LAYOUT_CAMERAS
              }
              onChange={(event) =>
                setIds(
                  event.target.checked
                    ? [...ids, camera.deviceId]
                    : ids.filter((id) => id !== camera.deviceId),
                )
              }
            />
            {camera.name} · {camera.deviceName}
          </label>
        ))}
      </fieldset>
      <ol aria-label="Camera order">
        {ordered.map((camera, index) => (
          <li key={camera.deviceId}>
            <span>
              {camera.name} · {camera.deviceName}
            </span>
            <button
              className="secondary"
              type="button"
              disabled={index === 0}
              aria-label={`Move ${camera.name} earlier`}
              onClick={() => move(index, -1)}
            >
              Move up
            </button>
            <button
              className="secondary"
              type="button"
              disabled={index === ordered.length - 1}
              aria-label={`Move ${camera.name} later`}
              onClick={() => move(index, 1)}
            >
              Move down
            </button>
          </li>
        ))}
      </ol>
      <div className="camera-wall-actions">
        <button
          className="primary"
          type="submit"
          disabled={!name.trim() || ids.length === 0}
        >
          Save layout
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
