import { describe, expect, it } from 'vitest';
import {
  activityDateStart,
  activitySince,
  localActivityDate,
} from './activity-filters';

describe('Activity date boundaries', () => {
  it('uses local midnight and rejects invalid dates', () => {
    expect(activityDateStart('2026-10-09')).toBe(
      new Date(2026, 9, 9).toISOString(),
    );
    expect(localActivityDate(new Date(2026, 0, 2, 23))).toBe('2026-01-02');
    for (const value of ['', '2026-02-30', '2026-13-01', 'bad', '26-10-09'])
      expect(activityDateStart(value)).toBeNull();
    expect(activityDateStart('2024-02-29')).not.toBeNull();
  });

  it('computes preset boundaries and leaves all time unbounded', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');
    expect(activitySince('24', '', now)).toBe('2026-10-08T12:00:00.000Z');
    expect(activitySince('7', '', now)).toBe('2026-10-02T12:00:00.000Z');
    expect(activitySince('30', '', now)).toBe('2026-09-09T12:00:00.000Z');
    expect(activitySince('all', '', now)).toBeNull();
    expect(activitySince('since', '2026-10-09', now)).toBe(
      activityDateStart('2026-10-09'),
    );
  });
});
