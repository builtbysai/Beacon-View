import { describe, expect, it } from 'vitest';
import {
  accessEventPresentation,
  groupAccessEvents,
  rejectionReasonLabel,
  type AccessEvent,
} from './access-history';

function event(overrides: Partial<AccessEvent>): AccessEvent {
  return {
    actorEmail: null,
    cameraName: null,
    deviceName: 'Pixel',
    eventType:
      overrides.success === false ? 'live_view_rejected' : 'live_view_started',
    occurredAt: '2026-01-01T00:00:00.000Z',
    reason: null,
    success: true,
    viewerSessionId: null,
    ...overrides,
  };
}

describe('groupAccessEvents', () => {
  it('collapses consecutive rows sharing a viewer_session_id into one attempt', () => {
    const events: AccessEvent[] = [
      event({
        occurredAt: '2026-01-01T00:00:03.000Z',
        success: true,
        viewerSessionId: 'v1',
      }),
      event({
        occurredAt: '2026-01-01T00:00:02.000Z',
        reason: 'camera_offline',
        success: false,
        viewerSessionId: 'v1',
      }),
      event({
        occurredAt: '2026-01-01T00:00:01.000Z',
        reason: 'camera_offline',
        success: false,
        viewerSessionId: 'v1',
      }),
    ];

    const groups = groupAccessEvents(events);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.attempts).toBe(3);
    // The group's outcome is the most recent row in the attempt, not the
    // first attempt tried.
    expect(groups[0]!.latest.success).toBe(true);
    expect(groups[0]!.latest.occurredAt).toBe('2026-01-01T00:00:03.000Z');
  });

  it('never merges rows across different viewer sessions, even when adjacent', () => {
    const events: AccessEvent[] = [
      event({ deviceName: 'Pixel', viewerSessionId: 'v1' }),
      event({ deviceName: 'Kitchen Pixel', viewerSessionId: 'v2' }),
    ];

    const groups = groupAccessEvents(events);

    expect(groups).toHaveLength(2);
    expect(groups[0]!.attempts).toBe(1);
    expect(groups[1]!.attempts).toBe(1);
  });

  it('never groups rows with no viewer_session_id, even if identical and adjacent', () => {
    const events: AccessEvent[] = [
      event({ viewerSessionId: null }),
      event({ viewerSessionId: null }),
    ];

    const groups = groupAccessEvents(events);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.attempts === 1)).toBe(true);
  });

  it('does not merge two separate sessions that happen to share an id with a gap between them', () => {
    // Guards against a naive "any two adjacent-in-time rows" heuristic:
    // only genuinely consecutive rows for the same session id merge.
    const events: AccessEvent[] = [
      event({ viewerSessionId: 'v1' }),
      event({ viewerSessionId: 'v2' }),
      event({ viewerSessionId: 'v1' }),
    ];

    const groups = groupAccessEvents(events);

    expect(groups).toHaveLength(3);
  });
});

describe('rejectionReasonLabel', () => {
  it('describes a known reason code in plain language', () => {
    expect(rejectionReasonLabel('camera_offline')).toBe('camera offline');
    expect(rejectionReasonLabel('not_authorized')).toBe('not authorized');
  });

  it('falls back to a generic message for an unrecognized or missing reason', () => {
    expect(rejectionReasonLabel(null)).toBe(
      'connection could not be established',
    );
    expect(rejectionReasonLabel('some_future_code')).toBe(
      'connection could not be established',
    );
  });
});

describe('accessEventPresentation', () => {
  it('uses clear labels for camera management and privacy events', () => {
    expect(
      accessEventPresentation(event({ eventType: 'privacy_enabled' })),
    ).toMatchObject({ label: 'Privacy mode enabled', tone: 'neutral' });
    expect(
      accessEventPresentation(event({ eventType: 'camera_source_deleted' })),
    ).toMatchObject({ label: 'Camera deleted', tone: 'danger' });
  });
});
