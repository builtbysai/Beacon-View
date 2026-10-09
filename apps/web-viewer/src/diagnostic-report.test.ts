import { describe, expect, it } from 'vitest';
import {
  diagnosticReport,
  heartbeatSummary,
  type DiagnosticSnapshot,
} from './diagnostic-report';

const at = new Date('2026-10-09T12:00:00Z');
describe('Troubleshooting report privacy', () => {
  it('omits identifiers, raw times, extra fields, and unexpected string values', () => {
    const snapshot = {
      householdId: 'private-household',
      email: 'private@example.com',
      token: 'private-token',
      devices: [
        {
          deviceId: 'private-device',
          platform: 'private-platform-token',
          connectionState: 'online',
          lastHeartbeatAt: '2026-10-09T11:59:30Z',
          softwareVersion: 'private-build-name',
        },
      ],
      cameras: [
        {
          cameraId: 'private-camera',
          captureState: 'streaming',
          availability: 'online',
          facing: 'rear',
          viewerCount: 2,
          viewerConnectionIds: ['private-connection'],
          sourceKey: 'private-source',
          sdp: 'private-sdp',
          ice: 'private-address',
        },
      ],
    };
    const report = diagnosticReport(snapshot, at);
    expect(report).not.toContain('private');
    expect(report).not.toContain('2026-10-09T11:59:30Z');
    expect(JSON.parse(report)).toMatchObject({
      reportVersion: 1,
      devices: [
        {
          platform: 'unknown',
          connection: 'online',
          heartbeat: 'Recent heartbeat',
        },
      ],
      cameras: [{ viewers: 2, capture: 'streaming' }],
    });
  });

  it('marks partial failure and never presents unavailable sections as healthy', () => {
    const snapshot: DiagnosticSnapshot = {
      unavailable: ['devices'],
      devices: [
        {
          deviceId: 'id',
          platform: 'android',
          connectionState: 'online',
          lastHeartbeatAt: null,
        },
      ],
      cameras: [],
    };
    expect(JSON.parse(diagnosticReport(snapshot, at))).toMatchObject({
      unavailable: ['devices'],
      devices: [],
    });
    const malformed: DiagnosticSnapshot = {
      devices: [],
      cameras: [
        {
          cameraId: 'id',
          facing: 'private-lens',
          captureState: 'private-token',
          viewerCount: Infinity,
          viewerConnectionIds: [],
        },
      ],
    };
    expect(JSON.parse(diagnosticReport(malformed, at))).toMatchObject({
      cameras: [{ facing: 'unknown', capture: 'unknown', viewers: null }],
    });
  });

  it('buckets heartbeat recency and handles missing, invalid, and future clocks', () => {
    expect(heartbeatSummary(null, at)).toBe('No heartbeat');
    expect(heartbeatSummary('bad', at)).toBe('Heartbeat time unknown');
    expect(heartbeatSummary('2026-10-10T12:00:00Z', at)).toBe(
      'Heartbeat time unknown',
    );
    expect(heartbeatSummary('2026-10-09T11:58:30Z', at)).toBe(
      'Recent heartbeat',
    );
    expect(heartbeatSummary('2026-10-09T11:58:29Z', at)).toBe(
      'Older heartbeat',
    );
  });
});
