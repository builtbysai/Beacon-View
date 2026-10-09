import { describe, expect, it } from 'vitest';

import {
  localParts,
  modeFromSchedule,
  modeSettingsSchema,
  windowOpen,
} from '../src/home-away.js';

const utc = (value: string) => new Date(value);

describe('Home and Away schedules', () => {
  const evenings = {
    days: [1, 2, 3, 4, 5],
    start: '18:00',
    end: '23:00',
    timeZone: 'America/New_York',
  };

  it('reads the weekday and minute in the window time zone', () => {
    // 2026-10-08 is a Thursday; 22:30 UTC is 18:30 in New York (EDT).
    expect(localParts(utc('2026-10-08T22:30:00Z'), 'America/New_York')).toEqual(
      { day: 4, minute: 18 * 60 + 30 },
    );
  });

  it('opens a same-day window only on its days and inside its hours', () => {
    expect(windowOpen(evenings, utc('2026-10-08T22:30:00Z'))).toBe(true);
    expect(windowOpen(evenings, utc('2026-10-08T21:30:00Z'))).toBe(false); // 17:30
    expect(windowOpen(evenings, utc('2026-10-09T03:30:00Z'))).toBe(false); // 23:30
    // Saturday 19:00 local is not in Monday to Friday.
    expect(windowOpen(evenings, utc('2026-10-10T23:00:00Z'))).toBe(false);
  });

  it('runs an overnight window into the next morning, belonging to the day it starts', () => {
    const fridayNight = {
      days: [5],
      start: '22:00',
      end: '06:00',
      timeZone: 'UTC',
    };
    expect(windowOpen(fridayNight, utc('2026-10-09T23:00:00Z'))).toBe(true); // Fri 23:00
    expect(windowOpen(fridayNight, utc('2026-10-10T05:59:00Z'))).toBe(true); // Sat 05:59
    expect(windowOpen(fridayNight, utc('2026-10-10T06:00:00Z'))).toBe(false);
    expect(windowOpen(fridayNight, utc('2026-10-09T05:00:00Z'))).toBe(false); // Fri morning
    expect(windowOpen(fridayNight, utc('2026-10-11T01:00:00Z'))).toBe(false); // Sun morning
  });

  it('is Home inside any window and Away outside all of them', () => {
    const schedule = { windows: [evenings] };
    expect(modeFromSchedule(schedule, utc('2026-10-08T22:30:00Z'))).toBe(
      'home',
    );
    expect(modeFromSchedule(schedule, utc('2026-10-08T15:00:00Z'))).toBe(
      'away',
    );
  });

  it('rejects malformed schedules', () => {
    const settings = (windows: unknown[]) => ({
      muteMotionWhenHome: true,
      pauseCamerasWhenHome: false,
      resumeCamerasWhenAway: false,
      schedule: { windows },
    });
    expect(modeSettingsSchema.safeParse(settings([evenings])).success).toBe(
      true,
    );
    expect(modeSettingsSchema.safeParse(settings([])).success).toBe(false);
    expect(
      modeSettingsSchema.safeParse(settings([{ ...evenings, days: [] }]))
        .success,
    ).toBe(false);
    expect(
      modeSettingsSchema.safeParse(settings([{ ...evenings, days: [1, 1] }]))
        .success,
    ).toBe(false);
    expect(
      modeSettingsSchema.safeParse(settings([{ ...evenings, end: '18:00' }]))
        .success,
    ).toBe(false);
    expect(
      modeSettingsSchema.safeParse(
        settings([{ ...evenings, timeZone: 'Mars/Olympus' }]),
      ).success,
    ).toBe(false);
    expect(
      modeSettingsSchema.safeParse({
        ...settings([evenings]),
        extra: true,
      }).success,
    ).toBe(false);
  });
});
