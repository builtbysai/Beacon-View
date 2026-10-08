import { z } from 'zod';

const cursorSchema = z
  .object({
    time: z.string().datetime().max(32),
    id: z.string().uuid(),
  })
  .strict();
const querySchema = z
  .object({
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export interface RecordingHistoryQuery {
  before?: { time: string; id: string };
  limit: number;
}

export function parseRecordingHistoryQuery(
  input: unknown,
): RecordingHistoryQuery | null {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return null;
  const { cursor, limit } = parsed.data;
  if (!cursor) return { limit };
  try {
    const before = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { before, limit };
  } catch {
    return null;
  }
}

export function recordingHistoryCursor(recording: {
  id: string;
  cursorTimestamp: string;
}): string {
  return Buffer.from(
    JSON.stringify({ time: recording.cursorTimestamp, id: recording.id }),
  ).toString('base64url');
}
