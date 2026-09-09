import { describe, expect, it } from 'vitest';
import { deviceGuidance } from './device-guidance';

const android = {
  cameraCount: 1,
  enabled: true,
  online: true,
  platform: 'android' as const,
  privacyMode: false,
  revoked: false,
};

describe('device setup and recovery guidance', () => {
  it('prioritizes revoked and disabled registration over connectivity', () => {
    expect(
      deviceGuidance({ ...android, online: false, revoked: true }),
    ).toMatchObject({
      attention: true,
      title: 'Pair this device again',
    });
    expect(deviceGuidance({ ...android, enabled: false })).toMatchObject({
      attention: true,
      title: 'Pairing is disabled',
    });
  });

  it('keeps offline privacy guidance honest about remote delivery', () => {
    const guidance = deviceGuidance({
      ...android,
      online: false,
      privacyMode: true,
    });
    expect(guidance.title).toBe('Privacy mode is blocking live view');
    expect(guidance.summary).toContain('when the device receives it');
    expect(guidance.steps.join(' ')).toContain('offline hardware');
  });

  it('gives platform-specific offline recovery without claiming remote diagnosis', () => {
    const androidGuidance = deviceGuidance({ ...android, online: false });
    expect(androidGuidance.summary).toContain('cannot inspect');
    expect(androidGuidance.steps.join(' ')).toContain('battery optimization');

    const browserGuidance = deviceGuidance({
      ...android,
      online: false,
      platform: 'browser',
    });
    expect(browserGuidance.steps.join(' ')).toContain('attended');
    expect(browserGuidance.steps.join(' ')).toContain('camera permission');
  });

  it('distinguishes unfinished setup from a ready device', () => {
    expect(deviceGuidance({ ...android, cameraCount: 0 }).title).toBe(
      'Finish camera setup',
    );
    expect(deviceGuidance(android)).toMatchObject({
      attention: false,
      title: 'Keep this camera ready',
    });
  });
});
