import { deviceGuidance } from './device-guidance';
import type { Device } from './domain';
import { Icon } from './Icon';

/** A paired device that has not reported a usable camera yet remains visible
 * and reachable without pretending that it has a camera tile. */
export function PendingDeviceRow({
  device,
  onOpen,
}: {
  device: Device;
  onOpen: () => void;
}) {
  const guidance = deviceGuidance({
    cameraCount: 0,
    enabled: device.enabled,
    online: device.online,
    platform: device.platform,
    privacyMode: device.privacyMode,
    revoked: device.revoked,
  });
  return (
    <li className="pending-device-row">
      <span className="item-icon" data-attention={guidance.attention}>
        <Icon name={device.platform === 'browser' ? 'browser' : 'phone'} />
      </span>
      <div className="pending-device-identity">
        <strong>{device.name}</strong>
        <span>{guidance.title}</span>
      </div>
      <button
        aria-label={`Open settings for ${device.name}`}
        className="quiet-button"
        onClick={onOpen}
      >
        Settings
        <Icon name="chevronRight" />
      </button>
    </li>
  );
}
