import type { CameraPower } from './camera-power';

export type CameraUseCase = 'general' | 'security' | 'baby' | 'doorbell';

interface CameraUseCaseInfo {
  id: CameraUseCase;
  label: string;
  /** What the preset does on an Android camera, which detects motion. */
  android: string;
  /** What it means for a computer or browser camera, which does not detect
   * motion -- so it must never promise alerts. */
  computer: string;
  /** Camera Mode defaults for a computer or browser camera. */
  power: CameraPower;
  microphone: boolean;
}

/** ADR 0084 / docs/camera-use-case-profiles.md Phase 1. Every use case is a
 * preset over settings Beacon already has; none records continuously. */
export const CAMERA_USE_CASES: readonly CameraUseCaseInfo[] = [
  {
    android: 'Uses the motion settings you choose.',
    computer: 'The camera stays on while Camera Mode runs.',
    id: 'general',
    label: 'General',
    microphone: false,
    power: 'always',
  },
  {
    android: 'Every movement alerts you and saves a short clip.',
    computer:
      'Stays on standby with the camera off, and turns on when you view it.',
    id: 'security',
    label: 'Security camera',
    microphone: false,
    power: 'standby',
  },
  {
    android:
      'Opens with sound. Motion alerts and clips are off — a sleeping baby moving isn’t an emergency.',
    computer:
      'Camera and sound stay on, and the live view opens with sound so you can check in instantly.',
    id: 'baby',
    label: 'Baby monitor',
    microphone: true,
    power: 'always',
  },
  {
    android:
      'The most responsive alerts and clips, with sound so you can hear visitors.',
    computer: 'Stays on standby with sound, and turns on when you view it.',
    id: 'doorbell',
    label: 'Door camera',
    microphone: true,
    power: 'standby',
  },
];

export function cameraUseCase(id: string | undefined): CameraUseCaseInfo {
  return (
    CAMERA_USE_CASES.find((useCase) => useCase.id === id) ??
    CAMERA_USE_CASES[0]!
  );
}
