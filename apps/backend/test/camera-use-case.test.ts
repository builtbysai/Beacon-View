import { describe, expect, it } from 'vitest';

import {
  CAMERA_USE_CASES,
  cameraUseCaseSchema,
  motionPresetFor,
} from '../src/camera-use-case.js';
import { motionSettingsSchema } from '../src/motion-settings.js';

describe('camera use cases', () => {
  it('produces only motion settings the product already supports', () => {
    for (const useCase of CAMERA_USE_CASES) {
      const preset = motionPresetFor(useCase);
      if (!preset) continue;
      expect(
        motionSettingsSchema.safeParse({ ...preset, quietHours: null }).success,
        useCase,
      ).toBe(true);
    }
  });

  it('matches the documented profiles', () => {
    expect(motionPresetFor('general')).toBeNull();
    expect(motionPresetFor('security')).toMatchObject({
      enabled: true,
      recordOnMotion: true,
    });
    expect(motionPresetFor('doorbell')).toMatchObject({
      cooldownSeconds: 30,
      sensitivity: 'high',
    });
    // A sleeping baby moving is not a security event.
    expect(motionPresetFor('baby')).toMatchObject({
      enabled: false,
      recordOnMotion: false,
    });
  });

  it('rejects unknown use cases', () => {
    expect(cameraUseCaseSchema.safeParse('dashcam').success).toBe(false);
  });
});
