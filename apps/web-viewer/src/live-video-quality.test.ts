import { describe, expect, it } from 'vitest';
import { readStreamQuality } from './live-video-quality';

function report(entries: Array<[string, Record<string, unknown>]>) {
  return new Map(entries) as unknown as RTCStatsReport;
}

describe('readStreamQuality', () => {
  it('returns null until inbound video statistics are available', () => {
    expect(readStreamQuality(report([]), null)).toBeNull();
  });

  it('calculates bitrate and identifies a direct path', () => {
    const result = readStreamQuality(
      report([
        [
          'video',
          {
            bytesReceived: 3_000,
            framesPerSecond: 14.6,
            id: 'video',
            jitter: 0.0124,
            kind: 'video',
            packetsLost: 2,
            timestamp: 3_000,
            type: 'inbound-rtp',
          },
        ],
        [
          'pair',
          {
            currentRoundTripTime: 0.0436,
            id: 'pair',
            localCandidateId: 'local',
            nominated: true,
            remoteCandidateId: 'remote',
            state: 'succeeded',
            timestamp: 3_000,
            type: 'candidate-pair',
          },
        ],
        ['local', { candidateType: 'host' }],
        ['remote', { candidateType: 'srflx' }],
      ]),
      { bytes: 1_000, timestamp: 1_000 },
    );

    expect(result).toEqual({
      previous: { bytes: 3_000, timestamp: 3_000 },
      quality: {
        bitrateKbps: 8,
        fps: 15,
        jitterMs: 12,
        lostPackets: 2,
        path: 'Direct',
        rttMs: 44,
      },
    });
  });

  it('identifies TURN when either selected candidate is relayed', () => {
    const result = readStreamQuality(
      report([
        [
          'video',
          {
            bytesReceived: 100,
            id: 'video',
            mediaType: 'video',
            timestamp: 10,
            type: 'inbound-rtp',
          },
        ],
        [
          'pair',
          {
            id: 'pair',
            localCandidateId: 'local',
            remoteCandidateId: 'remote',
            selected: true,
            state: 'succeeded',
            timestamp: 10,
            type: 'candidate-pair',
          },
        ],
        ['local', { candidateType: 'host' }],
        ['remote', { candidateType: 'relay' }],
      ]),
      null,
    );

    expect(result?.quality.path).toBe('TURN relay');
    expect(result?.quality.bitrateKbps).toBe(0);
  });
});
