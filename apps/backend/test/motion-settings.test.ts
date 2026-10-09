import { describe, expect, it } from 'vitest';
import {
  isQuietHoursActive,
  motionSettingsSchema,
  normalizeZones,
} from '../src/motion-settings.js';

describe('motion settings validation', () => {
  it.each([30, 60, 120, 300])(
    'accepts supported cooldown %i',
    (cooldownSeconds) => {
      expect(
        motionSettingsSchema.safeParse({
          enabled: false,
          recordOnMotion: false,
          sensitivity: 'medium',
          cooldownSeconds,
          quietHours: null,
        }).success,
      ).toBe(true);
    },
  );
  it.each([
    {
      enabled: 'false',
      recordOnMotion: false,
      sensitivity: 'high',
      cooldownSeconds: 30,
      quietHours: null,
    },
    {
      enabled: true,
      recordOnMotion: false,
      sensitivity: 'extreme',
      cooldownSeconds: 30,
      quietHours: null,
    },
    {
      enabled: true,
      recordOnMotion: false,
      sensitivity: 'low',
      cooldownSeconds: 0,
      quietHours: null,
    },
    {
      enabled: true,
      recordOnMotion: false,
      sensitivity: 'low',
      cooldownSeconds: 30,
      quietHours: null,
      householdId: 'other',
    },
    {
      enabled: true,
      recordOnMotion: false,
      sensitivity: 'low',
      cooldownSeconds: 31,
      quietHours: null,
    },
  ])('rejects invalid settings: %j', (input) => {
    expect(motionSettingsSchema.safeParse(input).success).toBe(false);
  });

  it('requires a complete canonical quiet-hours interval and handles midnight', () => {
    const base = {
      enabled: true,
      recordOnMotion: false,
      sensitivity: 'low',
      cooldownSeconds: 30,
    };
    expect(
      motionSettingsSchema.safeParse({
        ...base,
        quietHours: {
          start: '22:00',
          end: '07:00',
          timeZone: 'America/New_York',
        },
      }).success,
    ).toBe(true);
    expect(
      motionSettingsSchema.safeParse({
        ...base,
        quietHours: {
          start: '22:00',
          end: '22:00',
          timeZone: 'America/New_York',
        },
      }).success,
    ).toBe(false);
    expect(
      motionSettingsSchema.safeParse({
        ...base,
        quietHours: { start: '22:00', end: '07:00', timeZone: 'Eastern Time' },
      }).success,
    ).toBe(false);
    const quiet = {
      start: '22:00',
      end: '07:00',
      timeZone: 'America/New_York',
    };
    expect(isQuietHoursActive(quiet, new Date('2026-09-06T04:30:00Z'))).toBe(
      true,
    );
    expect(isQuietHoursActive(quiet, new Date('2026-09-06T16:30:00Z'))).toBe(
      false,
    );
  });

  describe('motion zones', () => {
    const base = {
      enabled: true,
      recordOnMotion: false,
      sensitivity: 'medium' as const,
      cooldownSeconds: 30,
      quietHours: null,
    };
    it('accepts cells of the 16 x 16 grid, and none at all', () => {
      expect(
        motionSettingsSchema.safeParse({ ...base, ignoredZones: [0, 255] })
          .success,
      ).toBe(true);
      expect(
        motionSettingsSchema.safeParse({ ...base, ignoredZones: [] }).success,
      ).toBe(true);
      expect(motionSettingsSchema.safeParse(base).success).toBe(true);
    });
    it('refuses cells off the grid, duplicates, and non-integers', () => {
      for (const ignoredZones of [[256], [-1], [3, 3], [1.5], ['4']])
        expect(
          motionSettingsSchema.safeParse({ ...base, ignoredZones }).success,
        ).toBe(false);
    });
    it('stores zones one way, whatever order they arrive in', () => {
      expect(normalizeZones([9, 2, 9, 5])).toEqual([2, 5, 9]);
    });
  });
});
