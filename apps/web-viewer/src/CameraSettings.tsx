import { useState } from 'react';

import { CameraFlipButton } from './CameraFlipButton';
import { CameraTile } from './CameraTile';
import { deviceGuidance } from './device-guidance';
import { capabilitySummary, relativeLastSeen } from './device-presentation';
import type { Camera, Device } from './domain';
import { Icon } from './Icon';
import { InlineRename } from './InlineRename';
import { MotionSettingsPanel } from './MotionSettingsPanel';
import { deviceKindLabel } from './naming';

export function CameraSettings({
  cameras,
  device,
  onBack,
  onLive,
  onDelete,
  onPrivacy,
  onRename,
  onCameraRename,
  onCameraDelete,
  onSwitchSource,
}: {
  cameras: Camera[];
  device: Device | undefined;
  onBack: () => void;
  onLive: (camera: Camera) => void;
  onDelete: (device: Device) => void;
  onPrivacy: (device: Device) => void;
  onRename: (device: Device, name: string) => void;
  onCameraRename: (camera: Camera, name: string) => void;
  onCameraDelete: (camera: Camera) => void;
  onSwitchSource: (camera: Camera) => void;
}) {
  const [renamingDevice, setRenamingDevice] = useState(false);
  if (!device) {
    return (
      <>
        <h3>Camera not found</h3>
        <p>This camera is unavailable or does not belong to your household.</p>
        <button onClick={onBack}>Back to Cameras</button>
      </>
    );
  }
  const viewers = cameras.reduce(
    (total, camera) => total + camera.viewerCount,
    0,
  );
  const connectionLabel = device.privacyMode
    ? 'Privacy mode on'
    : device.revoked
      ? 'Access revoked'
      : !device.enabled
        ? 'Pairing disabled'
        : device.online
          ? 'Online'
          : 'Offline';
  const batteryLabel =
    device.platform !== 'android'
      ? 'Not applicable'
      : device.batteryPercent === null || device.batteryPercent === undefined
        ? 'Not reported yet'
        : `${device.batteryPercent}%${device.batteryCharging ? ' · charging' : ''}`;
  const warning =
    device.online &&
    device.enabled &&
    !device.revoked &&
    !device.privacyMode &&
    device.batteryPercent !== null &&
    device.batteryPercent !== undefined &&
    device.batteryPercent <= 15 &&
    !device.batteryCharging
      ? 'Battery is low. Connect this camera to power to keep it available.'
      : null;
  const guidance = deviceGuidance({
    cameraCount: cameras.length,
    enabled: device.enabled,
    online: device.online,
    platform: device.platform,
    privacyMode: device.privacyMode,
    revoked: device.revoked,
  });
  return (
    <>
      <div className="heading device-heading">
        <div>
          <p className="eyebrow">{deviceKindLabel(device)}</p>
          {renamingDevice ? (
            <InlineRename
              value={device.name}
              ariaLabel="Rename this camera"
              className="inline-rename-heading"
              explicitActions
              onSubmit={(name) => {
                setRenamingDevice(false);
                onRename(device, name);
              }}
              onCancel={() => setRenamingDevice(false)}
            />
          ) : (
            <div className="heading-with-rename">
              <h3>{device.name}</h3>
              <button
                type="button"
                className="rename-affordance"
                aria-label="Rename this camera"
                onClick={() => setRenamingDevice(true)}
              >
                <Icon name="edit" />
              </button>
            </div>
          )}
        </div>
        <button
          className="secondary device-back-button"
          aria-label="Back to cameras"
          onClick={onBack}
        >
          <Icon name="chevronLeft" />
          <span>Cameras</span>
        </button>
      </div>
      <section className="device-health" aria-label="Device health">
        <div>
          <span>Connection</span>
          <strong
            className={
              device.online &&
              device.enabled &&
              !device.privacyMode &&
              !device.revoked
                ? 'online'
                : 'offline'
            }
          >
            {connectionLabel}
          </strong>
        </div>
        <div>
          <span>Last seen</span>
          <strong>{relativeLastSeen(device.lastSeenAt)}</strong>
        </div>
        <div>
          <span>Power</span>
          <strong>{batteryLabel}</strong>
        </div>
        <div>
          <span>Watching now</span>
          <strong>{viewers === 1 ? '1 viewer' : `${viewers} viewers`}</strong>
        </div>
      </section>
      {warning && (
        <p className="health-warning" role="status">
          {warning}
        </p>
      )}
      <details
        className={`device-guidance${guidance.attention ? ' attention' : ''}`}
      >
        <summary>
          <span>{guidance.title}</span>
          <span className="device-guidance-disclosure">
            {guidance.attention ? 'Troubleshoot' : 'Readiness tips'}
          </span>
        </summary>
        <div className="device-guidance-content">
          <p>{guidance.summary}</p>
          <ol>
            {guidance.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="device-guidance-boundary">
            The dashboard does not receive this device’s permission settings or
            inspect whether a local camera or microphone indicator is visible.
          </p>
        </div>
      </details>
      {device.platform === 'android' && (
        <section
          className="device-controls"
          aria-labelledby="device-privacy-title"
        >
          <div>
            <h4 id="device-privacy-title">Device privacy</h4>
            <p>
              Applies to every camera on this phone. Local privacy is the
              fastest way to stop capture.
            </p>
          </div>
          <button
            className={device.privacyMode ? '' : 'secondary'}
            onClick={() => onPrivacy(device)}
          >
            {device.privacyMode ? 'Resume' : 'Pause'}
          </button>
        </section>
      )}
      {cameras.length === 0 ? (
        <>
          <h4>Camera</h4>
          <p className="empty">No camera paired to this device yet.</p>
        </>
      ) : (
        <>
          <div className="section-heading">
            <h4>{cameras.length > 1 ? 'Sources' : 'Camera'}</h4>
            {cameras.length > 1 && (
              <CameraFlipButton
                sources={cameras}
                activeId={
                  (
                    cameras.find((camera) => camera.streaming) ??
                    cameras.find((camera) => camera.online) ??
                    cameras[0]!
                  ).id
                }
                onSwitch={(id) => {
                  const target = cameras.find((camera) => camera.id === id);
                  if (target) onSwitchSource(target);
                }}
              />
            )}
          </div>
          <div className="camera-tile-grid">
            {cameras.map((camera) => (
              <CameraTile
                key={camera.id}
                camera={camera}
                onOpen={onLive}
                onRename={onCameraRename}
                onDelete={onCameraDelete}
              />
            ))}
          </div>
        </>
      )}
      <details className="device-settings">
        <summary>Advanced</summary>
        <div className="device-settings-content">
          <p>Capabilities: {capabilitySummary(device.capabilities)}</p>
          <p>
            Software version: {device.softwareVersion ?? 'not reported'}
            {' · '}Access:{' '}
            {device.revoked
              ? 'Revoked'
              : device.enabled
                ? 'Active'
                : 'Disabled'}
          </p>
          <div className="heading-actions">
            <button className="danger" onClick={() => onDelete(device)}>
              Remove camera
            </button>
          </div>
          <p className="notice">
            Removing this camera disconnects every source paired to it. You can
            pair the device again later.
          </p>
        </div>
      </details>
      {device.platform === 'android' && !device.revoked && (
        <MotionSettingsPanel deviceId={device.id} cameras={cameras} />
      )}
    </>
  );
}
