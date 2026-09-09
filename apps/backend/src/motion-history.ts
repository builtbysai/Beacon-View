import { z } from 'zod';

const cursorSchema = z
  .object({
    time: z.string().datetime().max(32),
    id: z.string().uuid(),
  })
  .strict();
const querySchema = z
  .object({
    cameraId: z.string().uuid().optional(),
    since: z.string().datetime().max(32).optional(),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export interface MotionHistoryQuery {
  cameraId?: string;
  since?: string;
  before?: { time: string; id: string };
  limit: number;
}

export function parseMotionHistoryQuery(
  input: unknown,
): MotionHistoryQuery | null {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return null;
  const { cursor, cameraId, since, limit } = parsed.data;
  const query: MotionHistoryQuery = { limit };
  if (cameraId) query.cameraId = cameraId;
  if (since) query.since = since;
  if (!cursor) return query;
  try {
    const before = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { ...query, before };
  } catch {
    return null;
  }
}

export function motionHistoryCursor(event: {
  id: string;
  cursorTimestamp: string;
}): string {
  return Buffer.from(
    JSON.stringify({ time: event.cursorTimestamp, id: event.id }),
  ).toString('base64url');
}
