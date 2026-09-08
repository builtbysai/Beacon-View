export interface CameraAvailability {
  online: boolean;
  enabled: boolean;
  credentialRevoked: boolean;
  privacyMode?: boolean;
  streaming: boolean;
}

export function cameraStatus(camera: CameraAvailability) {
  if (camera.credentialRevoked)
    return {
      label: 'Pair again',
      tone: 'warning',
      available: false,
      explanation:
        'Camera access was removed. Pair this device again to reconnect.',
    };
  if (!camera.enabled)
    return {
      label: 'Disabled',
      tone: 'offline',
      available: false,
      explanation: 'Camera access is disabled. Check this device’s settings.',
    };
  if (camera.privacyMode)
    return {
      label: 'Privacy on',
      tone: 'privacy',
      available: false,
      explanation:
        'Live viewing is blocked. Capture stops when the device receives privacy mode.',
    };
  if (!camera.online)
    return {
      label: 'Offline',
      tone: 'offline',
      available: false,
      explanation: 'Check the camera’s power and internet connection.',
    };
  if (camera.streaming)
    return {
      label: 'Live',
      tone: 'streaming',
      available: true,
      explanation: 'Open the live view to see this camera.',
    };
  return {
    label: 'Ready',
    tone: 'online',
    available: true,
    explanation: 'Open the live view to see this camera.',
  };
}
