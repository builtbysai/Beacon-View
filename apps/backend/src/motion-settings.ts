import { z } from 'zod';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export interface QuietHours {
  start: string;
  end: string;
  timeZone: string;
}

export function isIanaTimeZone(timeZone: string): boolean {
  try {
    return (
      timeZone === 'UTC' ||
      Intl.supportedValuesOf('timeZone').includes(timeZone)
    );
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

export const motionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']),
    cooldownSeconds: z.union([
      z.literal(30),
      z.literal(60),
      z.literal(120),
      z.literal(300),
    ]),
    quietHours: quietHoursSchema.nullable(),
  })
  .strict();

export type MotionSettings = z.infer<typeof motionSettingsSchema>;
export interface CameraMotionSettings extends MotionSettings {
  cameraId: string;
}
