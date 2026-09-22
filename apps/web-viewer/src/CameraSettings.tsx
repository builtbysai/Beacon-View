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
import './CameraSettingsSheet.css';

export function CameraSettings({
  cameras,
  device,
  onBack,
  onLive,
  onDelete,
  onLeave,
  onPrivacy,
  onRename,
  onCameraRename,
  onCameraDelete,
  onCameraLeave,
  onSwitchSource,
  onReconnect,
}: {
  cameras: Camera[];
  device: Device | undefined;
  onBack: () => void;
  onLive: (camera: Camera) => void;
  onDelete: (device: Device) => void;
  onLeave?: (device: Device) => void;
  onPrivacy: (device: Device) => void;
  onRename: (device: Device, name: string) => void;
  onCameraRename: (camera: Camera, name: string) => void;
  onCameraDelete: (camera: Camera) => void;
  onCameraLeave?: (camera: Camera) => void;
  onSwitchSource: (camera: Camera) => void;
  onReconnect?: (device: Device) => void;
}) {
  const [renamingDevice, setRenamingDevice] = useState(false);

  if (!device) {
    return (
      <div className="camera-settings-missing">
        <h3>Camera not found</h3>
        <p>This camera is unavailable or does not belong to your household.</p>
        <button className="secondary" onClick={onBack}>
          Back to Cameras
        </button>
      </div>
    );
  }

  const viewers = cameras.reduce(
    (total, camera) => total + camera.viewerCount,
    0,
  );
  const healthy =
    device.online && device.enabled && !device.privacyMode && !device.revoked;
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
        ? 'Not reported'
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
  const needsReconnect =
    Boolean(onReconnect) &&
    device.platform === 'android' &&
    (!device.online || device.revoked);
  const guidance = deviceGuidance({
    cameraCount: cameras.length,
    enabled: device.enabled,
    online: device.online,
    platform: device.platform,
    privacyMode: device.privacyMode,
    revoked: device.revoked,
  });

  return (
    <div
      className="camera-settings-sheet"
      role="region"
      aria-label={`${device.name} settings`}
    >
      <header className="camera-settings-sheet-head">
        <button
          type="button"
          className="camera-settings-close"
          aria-label="Close camera settings"
          onClick={onBack}
        >
          <Icon name="close" />
        </button>
        <div className="camera-settings-identity">
          <span className="camera-settings-eyebrow">
            {deviceKindLabel(device)}
          </span>
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
            <div className="camera-settings-titleline">
              <h2>{device.name}</h2>
              <button
                type="button"
                className="camera-settings-rename"
                aria-label="Rename this camera"
                onClick={() => setRenamingDevice(true)}
              >
                <Icon name="edit" />
              </button>
            </div>
          )}
        </div>
        <span
          className={`camera-settings-status ${healthy ? 'is-online' : 'is-attention'}`}
        >
          {connectionLabel}
        </span>
      </header>

      <div className="camera-settings-sheet-body">
        <section className="camera-settings-summary" aria-label="Device health">
          <div>
            <span>Connection</span>
            <strong className={healthy ? 'online' : 'offline'}>
              {connectionLabel}
            </strong>
          </div>
          <div>
            <span>Last seen</span>
            <strong>{relativeLastSeen(device.lastSeenAt)}</strong>
          </div>
          <div>
            <span>Viewers</span>
            <strong>{viewers}</strong>
          </div>
        </section>

        {(needsReconnect || warning || guidance.attention) && (
          <section
            className="camera-settings-notice"
            aria-label="Camera attention"
          >
            <span className="camera-settings-notice-icon" aria-hidden="true">
              <Icon name="alert" />
            </span>
            <div>
              <strong>
                {needsReconnect
                  ? 'This camera needs to reconnect'
                  : warning
                    ? 'Camera needs attention'
                    : guidance.title}
              </strong>
              <p>
                {needsReconnect
                  ? 'Beacon cannot currently reach this phone. Reconnect it without deleting its settings.'
                  : (warning ?? guidance.summary)}
              </p>
              <div className="camera-settings-inline-actions">
                {needsReconnect && onReconnect && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onReconnect(device)}
                  >
                    Reconnect
                  </button>
                )}
                <details className="camera-settings-troubleshoot">
                  <summary>
                    {guidance.attention ? 'Troubleshoot' : 'Readiness tips'}
                  </summary>
                  <div>
                    <ol>
                      {guidance.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <p>{guidance.summary}</p>
                  </div>
                </details>
              </div>
            </div>
          </section>
        )}

        <section className="camera-settings-group">
          <div className="camera-settings-group-head">
            <div>
              <h3>{cameras.length > 1 ? 'Cameras' : 'Camera'}</h3>
              <p>Live view and source information.</p>
            </div>
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
          {cameras.length === 0 ? (
            <p className="camera-settings-empty">
              No camera paired to this device yet.
            </p>
          ) : (
            <div className="camera-settings-source-grid">
              {cameras.map((camera) => (
                <CameraTile
                  key={camera.id}
                  camera={camera}
                  onOpen={onLive}
                  {...(needsReconnect && onReconnect
                    ? { onReconnect: () => onReconnect(device) }
                    : {})}
                  onRename={onCameraRename}
                  onDelete={onCameraDelete}
                  {...(onCameraLeave ? { onLeave: onCameraLeave } : {})}
                />
              ))}
            </div>
          )}
        </section>

        {device.platform === 'android' && (
          <section className="camera-settings-group camera-settings-privacy">
            <div className="camera-settings-group-head">
              <div>
                <h3>Privacy</h3>
                <p>Pause capture from every camera on this phone.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={device.privacyMode}
                aria-label="Device privacy"
                className={`camera-settings-switch ${device.privacyMode ? 'is-on' : ''}`}
                onClick={() => onPrivacy(device)}
              >
                <span />
              </button>
            </div>
            <p className="camera-settings-boundary">
              Local privacy is the fastest way to stop camera and microphone
              capture.
            </p>
          </section>
        )}

        {device.platform === 'android' && !device.revoked && (
          <MotionSettingsPanel deviceId={device.id} cameras={cameras} />
        )}

        <section className="camera-settings-group">
          <div className="camera-settings-group-head">
            <div>
              <h3>Device information</h3>
            </div>
          </div>
          <dl className="camera-settings-info-list">
            <div>
              <dt>Device</dt>
              <dd>{deviceKindLabel(device)}</dd>
            </div>
            <div>
              <dt>Power</dt>
              <dd>{batteryLabel}</dd>
            </div>
            <div>
              <dt>Capabilities</dt>
              <dd>{capabilitySummary(device.capabilities)}</dd>
            </div>
            <div>
              <dt>Software version</dt>
              <dd>{device.softwareVersion ?? 'Not reported'}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {device.revoked
                  ? 'Revoked'
                  : device.enabled
                    ? 'Active'
                    : 'Disabled'}
              </dd>
            </div>
          </dl>
        </section>

        {(device.canRemove ||
          (onLeave && cameras.some((camera) => camera.canLeave))) && (
          <section className="camera-settings-group camera-settings-danger-wrap">
            <div className="camera-settings-danger">
              <h3>
                {device.canRemove ? 'Remove camera' : 'Leave this camera'}
              </h3>
              <p>
                {device.canRemove
                  ? 'Disconnects every source paired to this camera. You can pair the device again later.'
                  : 'You will stop seeing this camera. It stays paired and visible to the rest of the household.'}
              </p>
              {device.canRemove ? (
                <button className="danger" onClick={() => onDelete(device)}>
                  Remove camera
                </button>
              ) : (
                <button className="danger" onClick={() => onLeave?.(device)}>
                  Leave this camera
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      <footer className="camera-settings-sheet-foot">
        <span>
          Device changes apply immediately. Motion settings save separately.
        </span>
        <button type="button" className="secondary" onClick={onBack}>
          Done
        </button>
      </footer>
    </div>
  );
}
