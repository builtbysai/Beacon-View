import { z } from 'zod';

import { isIanaTimeZone, timeOfDayToMinute } from './motion-settings.js';

/**
 * Home and Away modes (ADR 0094).
 *
 * **Home** means someone is in; **Away** is the everyday watching state. A
 * household changes mode by hand or on a weekly schedule. Home can mute
 * motion alerts and, if the owner chose, pause Android cameras through the
 * normal privacy mode. Away can resume only the cameras Home itself paused,
 * and only if the owner opted in. Location-based presence is not part of
 * this: Beacon never learns where anyone is.
 */
export type HouseholdMode = 'home' | 'away';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);

export const scheduleWindowSchema = z
  .object({
    /** 0 is Sunday, 6 is Saturday, in the window's own time zone. */
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: 'Days must be unique',
      }),
    start: timeOfDay,
    end: timeOfDay,
    timeZone: z.string().refine(isIanaTimeZone, 'Unsupported IANA time zone'),
  })
  .strict()
  .refine((window) => window.start !== window.end, {
    message: 'A window must start and end at different times',
    path: ['end'],
  });

/** Times when the household is Home. Outside every window it is Away. */
export const scheduleSchema = z
  .object({ windows: z.array(scheduleWindowSchema).min(1).max(8) })
  .strict();

export type ModeSchedule = z.infer<typeof scheduleSchema>;
export type ScheduleWindow = z.infer<typeof scheduleWindowSchema>;

export const modeSettingsSchema = z
  .object({
    /** Home mutes motion alerts (offline, battery, and security still arrive). */
    muteMotionWhenHome: z.boolean(),
    /** Home pauses the household's Android cameras (privacy mode). */
    pauseCamerasWhenHome: z.boolean(),
    /** Away resumes the cameras Home paused. Off unless the owner opts in. */
    resumeCamerasWhenAway: z.boolean(),
    schedule: scheduleSchema.nullable(),
  })
  .strict();

export type ModeSettings = z.infer<typeof modeSettingsSchema>;

export const DEFAULT_MODE_SETTINGS: ModeSettings = {
  muteMotionWhenHome: true,
  pauseCamerasWhenHome: false,
  resumeCamerasWhenAway: false,
  schedule: null,
};

export const setModeSchema = z
  .object({ mode: z.enum(['home', 'away']) })
  .strict();

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** The local weekday (0 Sunday) and minute of day in a time zone. */
export function localParts(
  now: Date,
  timeZone: string,
): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: WEEKDAYS[value('weekday')] ?? 0,
    minute: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

/**
 * Whether one window is open now. A window that ends earlier than it starts
 * runs overnight and belongs to the day it starts on: "Fri 22:00 to 06:00"
 * is open on Friday night and Saturday morning.
 */
export function windowOpen(window: ScheduleWindow, now: Date): boolean {
  const { day, minute } = localParts(now, window.timeZone);
  const start = timeOfDayToMinute(window.start);
  const end = timeOfDayToMinute(window.end);
  if (start < end)
    return window.days.includes(day) && minute >= start && minute < end;
  const previousDay = (day + 6) % 7;
  return (
    (window.days.includes(day) && minute >= start) ||
    (window.days.includes(previousDay) && minute < end)
  );
}

/** The mode a schedule asks for right now. */
export function modeFromSchedule(
  schedule: ModeSchedule,
  now: Date,
): HouseholdMode {
  return schedule.windows.some((window) => windowOpen(window, now))
    ? 'home'
    : 'away';
}
