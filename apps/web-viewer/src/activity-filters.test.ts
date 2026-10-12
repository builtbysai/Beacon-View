import { describe, expect, it } from 'vitest';
import {
  activityDateStart,
  completeThroughEvents,
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

describe('merged Activity feeds', () => {
  const at = (hour: number) =>
    `2026-10-09T${String(hour).padStart(2, '0')}:00:00Z`;
  const motion = (id: string, hour: number) => ({
    id,
    kind: 'motion',
    occurredAt: at(hour),
  });
  const system = (id: string, hour: number) => ({
    id,
    kind: 'system',
    occurredAt: at(hour),
  });
  const feeds = (motionMore: boolean, systemMore: boolean) => [
    {
      hasMore: motionMore,
      belongs: (e: { kind: string }) => e.kind === 'motion',
    },
    {
      hasMore: systemMore,
      belongs: (e: { kind: string }) => e.kind === 'system',
    },
  ];

  it('hides events older than where a feed that has more has reached', () => {
    // Motion reached 10:00 and has more; household events go back to 02:00 but could be missing motion in between.
    const events = [
      motion('m1', 12),
      motion('m2', 10),
      system('s1', 11),
      system('s2', 6),
      system('s3', 2),
    ];
    expect(
      completeThroughEvents(events, feeds(true, false)).map((e) => e.id),
    ).toEqual(['m1', 'm2', 's1']);
  });

  it('shows everything once both feeds are exhausted', () => {
    const events = [motion('m1', 12), system('s1', 2)];
    expect(completeThroughEvents(events, feeds(false, false))).toHaveLength(2);
  });

  it('uses the newest limit when both feeds have more', () => {
    const events = [
      motion('m1', 12),
      motion('m2', 9),
      system('s1', 11),
      system('s2', 10),
    ];
    expect(
      completeThroughEvents(events, feeds(true, true)).map((e) => e.id),
    ).toEqual(['m1', 's1', 's2']);
  });
});
