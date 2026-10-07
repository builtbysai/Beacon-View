import { z } from 'zod';

import type { MotionSettings } from './motion-settings.js';

/**
 * What a camera is for (ADR 0084; docs/camera-use-case-profiles.md Phase 1).
 * A use case is a named preset over settings that already exist -- it adds
 * no new capture behavior and never enables continuous recording.
 */
export const CAMERA_USE_CASES = [
  'general',
  'security',
  'baby',
  'doorbell',
] as const;
export type CameraUseCase = (typeof CAMERA_USE_CASES)[number];
export const cameraUseCaseSchema = z.enum(CAMERA_USE_CASES);

export type MotionPreset = Pick<
  MotionSettings,
  'cooldownSeconds' | 'enabled' | 'recordOnMotion' | 'sensitivity'
>;

/**
 * Motion presets for cameras that detect motion on the device (Android).
 * Quiet hours are left exactly as the owner set them. `general` changes
 * nothing; it just clears the label.
 *
 * - security: every movement alerts and saves a short clip.
 * - doorbell: the most responsive -- high sensitivity, short cooldown.
 * - baby: a sleeping baby moving is not a security event, so motion alerts
 *   and clips are off; the live view opens with sound instead.
 */
export function motionPresetFor(useCase: CameraUseCase): MotionPreset | null {
  switch (useCase) {
    case 'security':
      return {
        cooldownSeconds: 60,
        enabled: true,
        recordOnMotion: true,
        sensitivity: 'medium',
      };
    case 'doorbell':
      return {
        cooldownSeconds: 30,
        enabled: true,
        recordOnMotion: true,
        sensitivity: 'high',
      };
    case 'baby':
      return {
        cooldownSeconds: 300,
        enabled: false,
        recordOnMotion: false,
        sensitivity: 'low',
      };
    case 'general':
      return null;
  }
}
