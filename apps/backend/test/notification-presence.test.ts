import { describe, expect, it } from 'vitest';

import {
  offlineCandidateSince,
  offlineGraceElapsed,
} from '../src/notification-presence.js';

describe('offline notification grace', () => {
  it('starts after the existing 90-second presence window and elapses exactly at 210 seconds', () => {
    const lastSeen = new Date('2026-09-11T12:00:00Z');
    const candidate = offlineCandidateSince(lastSeen);
    expect(candidate).toEqual(new Date('2026-09-11T12:01:30Z'));
    expect(
      offlineGraceElapsed(
        candidate,
        new Date(lastSeen.getTime() + 209_999),
        120,
      ),
    ).toBe(false);
    expect(
      offlineGraceElapsed(
        candidate,
        new Date(lastSeen.getTime() + 210_000),
        120,
      ),
    ).toBe(true);
  });
});
