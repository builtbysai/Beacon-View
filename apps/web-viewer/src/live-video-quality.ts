export interface StreamQuality {
  bitrateKbps: number;
  fps: number;
  jitterMs: number;
  lostPackets: number;
  path: string;
  rttMs: number;
}

export interface PreviousInboundBytes {
  bytes: number;
  timestamp: number;
}

interface InboundVideoStats extends RTCStats {
  bytesReceived: number;
  framesPerSecond?: number;
  jitter?: number;
  kind?: string;
  mediaType?: string;
  packetsLost?: number;
}

interface CandidatePairStats extends RTCStats {
  currentRoundTripTime?: number;
  localCandidateId?: string;
  nominated?: boolean;
  remoteCandidateId?: string;
  selected?: boolean;
  state?: string;
}

interface StreamStatsRecord extends CandidatePairStats {
  candidateType?: string;
  kind?: string;
  mediaType?: string;
}

export function readStreamQuality(
  report: RTCStatsReport,
  prior: PreviousInboundBytes | null,
): { previous: PreviousInboundBytes; quality: StreamQuality } | null {
  let inbound: InboundVideoStats | undefined;
  let selectedPair: CandidatePairStats | undefined;
  report.forEach((rawStat) => {
    const stat = rawStat as unknown as StreamStatsRecord;
    if (
      stat.type === 'inbound-rtp' &&
      (stat.kind === 'video' || stat.mediaType === 'video')
    ) {
      inbound = stat as InboundVideoStats;
    }
    if (
      stat.type === 'candidate-pair' &&
      stat.state === 'succeeded' &&
      (stat.nominated || stat.selected)
    ) {
      selectedPair = stat;
    }
  });
  if (!inbound) return null;

  const bitrateKbps =
    prior && inbound.timestamp > prior.timestamp
      ? Math.max(
          0,
          Math.round(
            ((inbound.bytesReceived - prior.bytes) * 8) /
              (inbound.timestamp - prior.timestamp),
          ),
        )
      : 0;
  const remote = selectedPair?.remoteCandidateId
    ? (report.get(selectedPair.remoteCandidateId) as unknown as
        StreamStatsRecord | undefined)
    : undefined;
  const local = selectedPair?.localCandidateId
    ? (report.get(selectedPair.localCandidateId) as unknown as
        StreamStatsRecord | undefined)
    : undefined;

  return {
    previous: {
      bytes: inbound.bytesReceived,
      timestamp: inbound.timestamp,
    },
    quality: {
      bitrateKbps,
      fps: Math.round(inbound.framesPerSecond ?? 0),
      jitterMs: Math.round((inbound.jitter ?? 0) * 1_000),
      lostPackets: inbound.packetsLost ?? 0,
      path:
        remote?.candidateType === 'relay' || local?.candidateType === 'relay'
          ? 'TURN relay'
          : remote && local
            ? 'Direct'
            : 'Checking connection',
      rttMs: Math.round((selectedPair?.currentRoundTripTime ?? 0) * 1_000),
    },
  };
}
