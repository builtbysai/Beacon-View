import { z } from 'zod';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

interface QuietHours {
  start: string;
  end: string;
  timeZone: string;
}

export function isIanaTimeZone(timeZone: string): boolean {
  try {
    if (timeZone === 'UTC') return true;
    // The canonical list leaves out older names that browsers and phones still
    // report (Asia/Calcutta, America/Buenos_Aires); ask the runtime itself (V64).
    if (Intl.supportedValuesOf('timeZone').includes(timeZone)) return true;
    if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/u.test(timeZone)) return false;
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const quietHoursSchema = z
  .object({
    start: timeOfDay,
    end: timeOfDay,
    timeZone: z.string().refine(isIanaTimeZone, 'Unsupported IANA time zone'),
  })
  .strict()
  .refine((value) => value.start !== value.end, {
    message: 'Quiet-hours start and end must differ',
    path: ['end'],
  });

export function timeOfDayToMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour! * 60 + minute!;
}

export function minuteToTimeOfDay(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** DST fall-back repeats are quiet twice; missing spring-forward minutes never occur. */
export function isQuietHoursActive(quietHours: QuietHours, now: Date): boolean {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: quietHours.timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = Number(values.find((part) => part.type === 'hour')?.value);
  const minute = Number(values.find((part) => part.type === 'minute')?.value);
  const current = hour * 60 + minute;
  const start = timeOfDayToMinute(quietHours.start);
  const end = timeOfDayToMinute(quietHours.end);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

/** Motion zones (ADR 0092): a 16 x 16 grid over the upright picture,
 * numbered row by row (0 is the top-left cell, 255 the bottom-right). */
const ZONE_GRID_SIZE = 16;
const ZONE_COUNT = ZONE_GRID_SIZE * ZONE_GRID_SIZE;

const ignoredZonesSchema = z
  .array(
    z
      .number()
      .int()
      .min(0)
      .max(ZONE_COUNT - 1),
  )
  .max(ZONE_COUNT)
  .refine((cells) => new Set(cells).size === cells.length, {
    message: 'Zone cells must be unique',
  });

/** Sorted and de-duplicated, so equal zones are stored one way. */
export function normalizeZones(cells: readonly number[]): number[] {
  return [...new Set(cells)].sort((a, b) => a - b);
}

export const motionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    // Starts a short recording for every motion event this camera reports,
    // subject to the same enabled/sensitivity/cooldown/quiet-hours gating
    // above -- never a separate trigger. Requires the household owner to
    // have Google Drive connected with the recording scope; silently
    // skipped (not an error) when they don't.
    recordOnMotion: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']),
    cooldownSeconds: z.union([
      z.literal(30),
      z.literal(60),
      z.literal(120),
      z.literal(300),
    ]),
    quietHours: quietHoursSchema.nullable(),
    // Optional so older clients that omit it leave the zones alone.
    ignoredZones: ignoredZonesSchema.optional(),
  })
  .strict();

export type MotionSettings = z.infer<typeof motionSettingsSchema>;
export interface CameraMotionSettings extends MotionSettings {
  cameraId: string;
  ignoredZones: number[];
}
