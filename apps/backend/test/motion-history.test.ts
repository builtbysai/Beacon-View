import { describe, expect, it } from 'vitest';
import {
  motionHistoryCursor,
  parseMotionHistoryQuery,
} from '../src/motion-history.js';

describe('motion history query validation', () => {
  it('preserves microsecond timestamps through a bounded cursor', () => {
    const event = {
      id: '00000000-0000-4000-8000-000000000001',
      cursorTimestamp: '2026-09-05T01:02:03.123456Z',
    };
    expect(
      parseMotionHistoryQuery({
        cursor: motionHistoryCursor(event),
        limit: '1',
      }),
    ).toEqual({
      limit: 1,
      before: { time: event.cursorTimestamp, id: event.id },
    });
    expect(parseMotionHistoryQuery({})).toEqual({ limit: 50 });
  });
  it.each([
    { limit: '101' },
    { limit: '0' },
    { limit: '1.5' },
    { limit: ['1', '2'] },
    { cameraId: 'invalid' },
    { since: '2026-02-30T00:00:00Z' },
    { since: 'yesterday' },
    { cursor: 'a'.repeat(257) },
    { cursor: 'invalid!' },
    { cursor: 'e30' },
    { householdId: 'other-household' },
    {
      cursor: Buffer.from(
        '{"id":"bad","time":"2026-01-01T00:00:00Z"}',
      ).toString('base64url'),
    },
  ])('rejects malformed or unbounded filters: %j', (input) => {
    expect(parseMotionHistoryQuery(input)).toBeNull();
  });
});
