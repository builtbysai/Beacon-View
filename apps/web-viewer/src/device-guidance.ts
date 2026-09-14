export interface DeviceGuidanceInput {
  cameraCount: number;
  enabled: boolean;
  online: boolean;
  platform: 'android' | 'browser';
  privacyMode: boolean | undefined;
  revoked: boolean;
}

export interface DeviceGuidance {
  attention: boolean;
  summary: string;
  steps: string[];
  title: string;
}

export function deviceGuidance(device: DeviceGuidanceInput): DeviceGuidance {
  if (device.revoked) {
    return {
      attention: true,
      title: 'Pair this device again',
      summary:
        'Its access was revoked, so it cannot reconnect with the old pairing.',
      steps: [
        'Create a fresh one-time setup link from Add camera.',
        device.platform === 'android'
          ? 'Open Beacon on the camera phone and complete pairing with the new link or code.'
          : 'Return to Browser Camera Mode in the attended browser and register its sources again.',
      ],
    };
  }

  if (!device.enabled) {
    return {
      attention: true,
      title: 'Pairing is disabled',
      summary:
        "Beacon won't accept camera connections from this device until it's paired again.",
      steps: [
        'Confirm that this is the device you intend to restore.',
        'Create a fresh one-time setup link from Add camera and pair the device again.',
      ],
    };
  }

  if (device.privacyMode) {
    return {
      attention: true,
      title: 'Privacy mode is blocking live view',
      summary:
        'Live viewing is blocked. A remote privacy change stops capture when the device receives it; the camera device is the source of truth for immediate local shutdown.',
      steps:
        device.platform === 'android'
          ? [
              'Use the privacy control on the camera phone for an immediate local change.',
              device.online
                ? 'When you are ready, turn privacy off here or on the camera phone and confirm the visible Camera Mode indicator returns.'
                : 'Bring the phone online before relying on a remote change; queued state cannot prove that offline hardware has applied it.',
            ]
          : [
              'Return to the attended Browser Camera Mode tab.',
              'Start Camera Mode again only when visible capture is intended.',
            ],
    };
  }

  if (!device.online) {
    if (device.platform === 'browser') {
      return {
        attention: true,
        title: 'Browser camera is paused',
        summary:
          'A browser camera is available only while Camera mode is open in that browser.',
        steps: [
          'Open Add camera on that computer and choose Use this browser.',
          'Allow camera access and leave Camera mode open while you want to share.',
        ],
      };
    }
    return {
      attention: true,
      title: 'Bring this device back online',
      summary:
        'Beacon has no current connection to this device and cannot inspect its local power, network, or permission state.',
      steps: [
        'Connect the phone to power and a working Wi-Fi or cellular network.',
        'Open Beacon and confirm Camera Mode is running with its persistent notification.',
        'If it stays offline, check Android camera and notification permissions.',
      ],
    };
  }

  if (device.cameraCount === 0) {
    return {
      attention: true,
      title: 'Finish camera setup',
      summary:
        'The device is connected, but it has not reported a camera that can be viewed.',
      steps: [
        device.platform === 'android'
          ? 'Open Camera Mode on the device and allow camera permission when Android asks.'
          : 'Open Browser Camera Mode, allow camera access, and choose a camera.',
        'Keep the setup screen visible until the camera appears here.',
      ],
    };
  }

  return {
    attention: false,
    title: 'Keep this camera ready',
    summary:
      'The device is connected and has a working camera. Beacon still depends on its local permissions, power, and network.',
    steps:
      device.platform === 'android'
        ? [
            'Keep Camera Mode running with its persistent notification visible.',
            'Use continuous power for longer sessions and check the phone if this status becomes stale.',
          ]
        : [
            'Keep the attended Camera Mode tab visible while capture is intended.',
            'Browsers may pause capture or networking when the tab or device sleeps.',
          ],
  };
}
