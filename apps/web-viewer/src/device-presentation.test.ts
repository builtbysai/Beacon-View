import { describe, expect, it } from 'vitest';

import { capabilitySummary, relativeLastSeen } from './device-presentation';

describe('device presentation', () => {
  const now = Date.parse('2026-09-11T00:00:00.000Z');

  it('presents missing and recent presence without leaking protocol values', () => {
    expect(relativeLastSeen(null, now)).toBe('Never');
    expect(relativeLastSeen('2026-09-10T23:59:30.000Z', now)).toBe('Just now');
    expect(relativeLastSeen('2026-09-10T23:45:00.000Z', now)).toBe(
      '15 min ago',
    );
    expect(relativeLastSeen('2026-09-10T21:00:00.000Z', now)).toBe('3 hr ago');
  });

  it('keeps capability text concise and omits disabled capabilities', () => {
    expect(capabilitySummary(undefined)).toBe('Standard video');
    expect(
      capabilitySummary({ audio: true, frame_rate: 15, torch: false }),
    ).toBe('audio · frame rate: 15');
  });
});
