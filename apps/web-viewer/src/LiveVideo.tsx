import { useCallback, useEffect, useRef, useState } from 'react';
import { TalkSession, type TalkState } from './talk';

import {
  type ConnectionFailure,
  mayRetry,
  RetryGeneration,
  retryDelay,
} from './reconnect';

interface Camera {
  id: string;
  name: string;
}

interface ReadyMessage {
  connectionId: string;
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  type: 'ready';
}

interface OfferMessage {
  connectionId: string;
  sdp: string;
  type: 'offer';
}

interface IceMessage {
  candidate: RTCIceCandidateInit;
  connectionId: string;
  type: 'ice';
}

type ServerMessage =
  | ReadyMessage
  | OfferMessage
  | IceMessage
  | {
      active: boolean;
      connectionId: string;
      reason?: 'busy';
      type: 'talk-state';
    }
  | { code: string; type: 'error' | 'peer-left' };

type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'stream unavailable'
  | 'privacy on'
  | 'switching source'
  | ConnectionFailure;

interface StreamQuality {
  bitrateKbps: number;
  fps: number;
  jitterMs: number;
  lostPackets: number;
  path: string;
  rttMs: number;
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

function signalingUrl(cameraId: string): string {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'viewer');
  url.searchParams.set('cameraId', cameraId);
  return url.toString();
}

export function LiveVideo({
  enabled = true,
  camera,
  compact = false,
  deviceName,
  onDevice,
  viewerCount = 0,
  onBack,
  onSelectCamera,
  onPrivacy,
  privacyMode = false,
  siblingCameras = [],
}: {
  enabled?: boolean;
  camera: Camera;
  compact?: boolean;
  deviceName?: string;
  onDevice?: () => void;
  viewerCount?: number;
  onBack?: () => void;
  onSelectCamera?: (cameraId: string) => Promise<void> | void;
  onPrivacy?: (() => Promise<void>) | undefined;
  privacyMode?: boolean | undefined;
  siblingCameras?: Camera[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const generation = useRef(new RetryGeneration());
  const retryCount = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [retryDisplay, setRetryDisplay] = useState(0);
  const [quality, setQuality] = useState<StreamQuality | null>(null);
  const [listening, setListening] = useState(false);
  const [talkState, setTalkState] = useState<TalkState>('idle');
  const talkSession = useRef<TalkSession | null>(null);
  const qualityTimer = useRef<number | null>(null);
  const previousBytes = useRef<{ bytes: number; timestamp: number } | null>(
    null,
  );
  const stageRef = useRef<HTMLElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlError, setControlError] = useState('');
  const [switching, setSwitching] = useState(false);
  const switchInProgress = useRef(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const playbackGeneration = useRef(0);

  useEffect(() => {
    let wasFullscreen = false;
    const changed = () => {
      const expanded = document.fullscreenElement === stageRef.current;
      setFullscreen(expanded);
      if (wasFullscreen && !expanded) fullscreenButton.current?.focus();
      wasFullscreen = expanded;
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const reconnect = useCallback(() => {
    retryCount.current = 0;
    setRetryDisplay(0);
    generation.current.cancel();
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    setStatus('connecting');
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    setQuality(null);
    if (!enabled || privacyMode) {
      setStatus(privacyMode ? 'privacy on' : 'stream unavailable');
      return;
    }
    setStatus((current) =>
      current === 'reconnecting' ? current : 'connecting',
    );
    const currentGeneration = generation.current.next();
    let active = true;
    let completed = false;
    const socket = new WebSocket(signalingUrl(camera.id));
    socketRef.current = socket;
    const timeout = window.setTimeout(
      () => fail('connection timed out'),
      15_000,
    );

    function cleanup() {
      active = false;
      playbackGeneration.current += 1;
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
      talkSession.current?.dispose();
      talkSession.current = null;
      window.clearTimeout(timeout);
      if (qualityTimer.current !== null)
        window.clearInterval(qualityTimer.current);
      qualityTimer.current = null;
      previousBytes.current = null;
      const connectionId = connectionIdRef.current;
      if (connectionId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ connectionId, type: 'disconnect' }));
      }
      socket.close();
      peerRef.current?.close();
      if (videoRef.current) videoRef.current.srcObject = null;
      if (socketRef.current === socket) socketRef.current = null;
      peerRef.current = null;
      connectionIdRef.current = null;
      pendingIce.current = [];
    }

    function fail(reason: ConnectionFailure) {
      if (
        !active ||
        completed ||
        !generation.current.isCurrent(currentGeneration)
      )
        return;
      completed = true;
      cleanup();
      const nextRetry = retryCount.current;
      if (mayRetry(reason, nextRetry)) {
        retryCount.current += 1;
        setRetryDisplay(retryCount.current);
        setStatus('reconnecting');
        retryTimer.current = window.setTimeout(
          () => setAttempt((value) => value + 1),
          retryDelay(nextRetry, Math.random()),
        );
      } else {
        setStatus(reason);
      }
    }

    async function handleMessage(event: MessageEvent) {
      if (!active || !generation.current.isCurrent(currentGeneration)) return;
      if (typeof event.data !== 'string') throw new Error('Invalid message');
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'talk-state') {
        talkSession.current?.receive(message);
        return;
      }
      if (message.type === 'error' || message.type === 'peer-left') {
        fail(
          message.code === 'camera_unavailable' ||
            message.code === 'camera_disconnected'
            ? 'camera offline'
            : message.code === 'negotiation_timeout'
              ? 'connection timed out'
              : 'signaling unavailable',
        );
        return;
      }
      if (message.type === 'ready') {
        connectionIdRef.current = message.connectionId;
        const peer = new RTCPeerConnection({
          iceServers: message.iceServers,
          iceTransportPolicy: message.iceTransportPolicy,
        });
        peerRef.current = peer;
        talkSession.current = new TalkSession(
          message.connectionId,
          peer,
          (outgoing) => {
            if (socket.readyState !== WebSocket.OPEN)
              throw new Error('Disconnected');
            socket.send(JSON.stringify(outgoing));
          },
          setTalkState,
        );
        peer.ontrack = (trackEvent) => {
          const lowLatencyReceiver = trackEvent.receiver as RTCRtpReceiver & {
            jitterBufferTarget?: number;
            playoutDelayHint?: number;
          };
          if ('playoutDelayHint' in lowLatencyReceiver)
            lowLatencyReceiver.playoutDelayHint = 0;
          if ('jitterBufferTarget' in lowLatencyReceiver)
            lowLatencyReceiver.jitterBufferTarget = 0;
          if (videoRef.current) {
            videoRef.current.srcObject = trackEvent.streams[0] ?? null;
          }
        };
        peer.onicecandidate = (candidateEvent) => {
          if (!candidateEvent.candidate || socket.readyState !== WebSocket.OPEN)
            return;
          socket.send(
            JSON.stringify({
              candidate: candidateEvent.candidate.toJSON(),
              connectionId: connectionIdRef.current,
              type: 'ice',
            }),
          );
        };
        peer.onconnectionstatechange = () => {
          if (!active || !generation.current.isCurrent(currentGeneration))
            return;
          if (peer.connectionState === 'connected') {
            window.clearTimeout(timeout);
            retryCount.current = 0;
            setRetryDisplay(0);
            setStatus('connected');
            if (!compact) {
              if (qualityTimer.current !== null)
                window.clearInterval(qualityTimer.current);
              qualityTimer.current = window.setInterval(() => {
                void updateStreamQuality(peer).catch(() => {
                  if (active) setQuality(null);
                });
              }, 2_000);
              void updateStreamQuality(peer).catch(() => {
                if (active) setQuality(null);
              });
            }
            socket.send(
              JSON.stringify({
                connectionId: connectionIdRef.current,
                type: 'connected',
              }),
            );
          } else if (
            peer.connectionState === 'failed' ||
            peer.connectionState === 'disconnected' ||
            peer.connectionState === 'closed'
          ) {
            fail(
              peer.connectionState === 'failed'
                ? 'ICE failed'
                : 'signaling unavailable',
            );
          }
        };
        return;
      }
      const peer = peerRef.current;
      if (!peer) return;
      if (message.type === 'offer') {
        await peer.setRemoteDescription({
          sdp: message.sdp,
          type: 'offer',
        });
        if (!active || !generation.current.isCurrent(currentGeneration)) return;
        // Negotiate the offered return-audio channel without opening a microphone.
        // The producer's offer limits the final direction of each audio section.
        for (const transceiver of peer.getTransceivers()) {
          if (transceiver.receiver.track.kind === 'audio')
            transceiver.direction = 'sendrecv';
        }
        for (const candidate of pendingIce.current.splice(0)) {
          await peer.addIceCandidate(candidate);
        }
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (!active || !generation.current.isCurrent(currentGeneration)) return;
        socket.send(
          JSON.stringify({
            connectionId: message.connectionId,
            sdp: answer.sdp,
            type: 'answer',
          }),
        );
      } else if (message.type === 'ice') {
        if (peer.remoteDescription) {
          await peer.addIceCandidate(message.candidate);
        } else {
          pendingIce.current.push(message.candidate);
        }
      }
    }

    async function updateStreamQuality(peer: RTCPeerConnection) {
      const report = await peer.getStats();
      if (!active || !generation.current.isCurrent(currentGeneration)) return;
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
      if (!inbound) return;
      const prior = previousBytes.current;
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
      previousBytes.current = {
        bytes: inbound.bytesReceived,
        timestamp: inbound.timestamp,
      };
      const remote = selectedPair?.remoteCandidateId
        ? (report.get(selectedPair.remoteCandidateId) as unknown as
            StreamStatsRecord | undefined)
        : undefined;
      const local = selectedPair?.localCandidateId
        ? (report.get(selectedPair.localCandidateId) as unknown as
            StreamStatsRecord | undefined)
        : undefined;
      setQuality({
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
      });
    }

    socket.onmessage = (event) => {
      void handleMessage(event).catch(() => fail('signaling unavailable'));
    };
    socket.onerror = () => fail('signaling unavailable');
    socket.onclose = (event) =>
      fail(
        event.code === 4003 ? 'authorization lost' : 'signaling unavailable',
      );

    return () => {
      completed = true;
      cleanup();
    };
  }, [enabled, privacyMode, attempt, camera.id, compact]);

  useEffect(
    () => () => {
      generation.current.cancel();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    },
    [],
  );

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden) talkSession.current?.stop('recovering');
    };
    const stopOnPageExit = () => talkSession.current?.stop('recovering');
    document.addEventListener('visibilitychange', stopWhenHidden);
    window.addEventListener('pagehide', stopOnPageExit);
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden);
      window.removeEventListener('pagehide', stopOnPageExit);
    };
  }, []);

  const content = (
    <>
      {!compact && (
        <div className="heading">
          <div>
            <p className="eyebrow">
              {deviceName ? `${deviceName} / Live view` : 'Live view'}
            </p>
            <h1 id="live-title">{camera.name}</h1>
            <span>
              {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
            </span>
          </div>
          <button className="secondary" onClick={onBack} type="button">
            Back to cameras
          </button>
        </div>
      )}
      <div className="video-frame">
        <video ref={videoRef} autoPlay playsInline muted={!listening} />
        {(status !== 'connected' || switching) && (
          <div className="video-overlay">
            <strong>
              {switching
                ? 'Switching camera'
                : status === 'privacy on'
                  ? 'Privacy is on'
                  : status === 'connecting'
                    ? 'Connecting to camera'
                    : status === 'reconnecting'
                      ? 'Connection interrupted'
                      : status === 'switching source'
                        ? 'Switching camera'
                        : status}
            </strong>
            <span>
              {switching
                ? 'The device is changing camera sources.'
                : status === 'privacy on'
                  ? 'Live viewing is blocked. Turn privacy off when you are ready to resume.'
                  : status === 'connecting'
                    ? 'Waiting for the secure live stream.'
                    : status === 'reconnecting'
                      ? `Beacon is retrying${retryDisplay ? ` · attempt ${retryDisplay}` : ''}.`
                      : status === 'switching source'
                        ? 'The device is releasing the previous camera source.'
                        : 'This stream needs your attention.'}
            </span>
          </div>
        )}
      </div>
      <p className="visually-hidden" role="status">
        Connection: {status}
      </p>
      {!compact && (
        <>
          <div
            className="heading-actions live-controls"
            aria-label="Live view controls"
          >
            <span className={status === 'connected' ? 'streaming' : 'offline'}>
              {status === 'connected' ? 'LIVE' : status.toUpperCase()}
            </span>
            <button
              className="secondary"
              ref={fullscreenButton}
              onClick={() => {
                setControlError('');
                if (
                  !stageRef.current?.requestFullscreen ||
                  !document.exitFullscreen
                ) {
                  setControlError(
                    'Full screen is unavailable in this browser. You can keep watching here.',
                  );
                  return;
                }
                void (
                  fullscreen
                    ? document.exitFullscreen()
                    : stageRef.current.requestFullscreen()
                ).catch(() =>
                  setControlError(
                    'Full screen could not open. You can keep watching here.',
                  ),
                );
              }}
              type="button"
            >
              {fullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
            <button
              aria-pressed={listening}
              className="secondary"
              onClick={() => {
                const next = !listening;
                const current = ++playbackGeneration.current;
                setControlError('');
                setListening(next);
                if (videoRef.current) {
                  const video = videoRef.current;
                  video.muted = !next;
                  if (next)
                    void Promise.resolve(video.play()).catch(() => {
                      if (current !== playbackGeneration.current) return;
                      video.muted = true;
                      setListening(false);
                      setControlError(
                        'Sound could not start. Choose Listen to try again, and check your browser sound settings.',
                      );
                    });
                }
              }}
              type="button"
            >
              {listening ? 'Mute' : 'Listen'}
            </button>
            <button
              aria-pressed={talkState === 'speaking'}
              className={talkState === 'speaking' ? '' : 'secondary'}
              disabled={
                switching ||
                privacyBusy ||
                privacyMode ||
                (status !== 'connected' &&
                  !['permission', 'connecting', 'speaking'].includes(talkState))
              }
              onClick={() => {
                if (
                  ['permission', 'connecting', 'speaking'].includes(talkState)
                )
                  talkSession.current?.stop();
                else void talkSession.current?.start();
              }}
              type="button"
            >
              {talkState === 'speaking'
                ? 'Stop talking'
                : talkState === 'permission' || talkState === 'connecting'
                  ? 'Cancel talk'
                  : 'Talk'}
            </button>
            {onPrivacy && (
              <button
                className="secondary"
                disabled={privacyBusy}
                onClick={() => {
                  talkSession.current?.stop();
                  setPrivacyBusy(true);
                  setControlError('');
                  void onPrivacy()
                    .catch(() =>
                      setControlError(
                        'Privacy could not be changed. Check your connection and try again.',
                      ),
                    )
                    .finally(() => setPrivacyBusy(false));
                }}
                type="button"
              >
                {privacyBusy
                  ? 'Updating privacy…'
                  : privacyMode
                    ? 'Turn privacy off'
                    : 'Turn privacy on'}
              </button>
            )}
          </div>
          {controlError && <p role="alert">{controlError}</p>}
          <p role="status" aria-label="Talk status">
            {talkState === 'permission'
              ? 'Allow microphone access in your browser to talk. You can cancel at any time.'
              : talkState === 'connecting'
                ? 'Connecting talk. Your microphone audio is not being sent yet.'
                : talkState === 'speaking'
                  ? 'Speaking · your microphone is on. The camera plays your voice.'
                  : talkState === 'busy'
                    ? 'Another viewer is talking. Try Talk again when they finish.'
                    : talkState === 'unavailable'
                      ? 'Talk is unavailable. Check microphone permission and that this camera supports talk, then try again.'
                      : talkState === 'recovering'
                        ? 'Your microphone is off. When the camera reconnects, choose Talk to speak again.'
                        : 'Your microphone is off.'}
          </p>
          {quality && (
            <details className="connection-details">
              <summary>Connection details · {quality.path}</summary>
              <dl className="stream-quality" aria-label="Live stream quality">
                <div>
                  <dt>Path</dt>
                  <dd>{quality.path}</dd>
                </div>
                <div>
                  <dt>Video</dt>
                  <dd>
                    {quality.fps} fps · {quality.bitrateKbps} kbps
                  </dd>
                </div>
                <div>
                  <dt>Latency</dt>
                  <dd>
                    {quality.rttMs} ms RTT · {quality.jitterMs} ms jitter
                  </dd>
                </div>
                <div>
                  <dt>Loss</dt>
                  <dd>{quality.lostPackets} packets</dd>
                </div>
              </dl>
            </details>
          )}
          {siblingCameras.length > 1 && (
            <div
              className="heading-actions"
              aria-label="Sibling camera sources"
            >
              {siblingCameras.map((sibling) => (
                <button
                  className={sibling.id === camera.id ? '' : 'secondary'}
                  disabled={
                    sibling.id === camera.id ||
                    switching ||
                    privacyMode ||
                    privacyBusy
                  }
                  key={sibling.id}
                  onClick={() => {
                    if (switchInProgress.current) return;
                    switchInProgress.current = true;
                    talkSession.current?.stop();
                    setSwitching(true);
                    setControlError('');
                    void Promise.resolve()
                      .then(() => onSelectCamera?.(sibling.id))
                      .catch(() =>
                        setControlError(
                          'The camera could not switch. Your current view remains selected. Try again.',
                        ),
                      )
                      .finally(() => {
                        switchInProgress.current = false;
                        setSwitching(false);
                      });
                  }}
                  type="button"
                >
                  {sibling.name}
                </button>
              ))}
            </div>
          )}
          {enabled &&
            !privacyMode &&
            status !== 'connected' &&
            status !== 'connecting' &&
            status !== 'reconnecting' && (
              <button onClick={reconnect}>Reconnect</button>
            )}
          <p className="notice">
            Closing this view ends only your viewer session. The camera remains
            online and ready for the next authorized viewer. Listening starts
            only after you choose Listen. Talk requests microphone access only
            when selected and plays a tone at the camera. Recording is disabled.
          </p>
        </>
      )}
      {compact && (
        <div className="tile-controls">
          <span className={status === 'connected' ? 'streaming' : 'offline'}>
            {status === 'connected' ? 'LIVE' : status.toUpperCase()}
          </span>
          {onDevice && (
            <button className="link" onClick={onDevice} type="button">
              Device
            </button>
          )}
          {status !== 'connected' &&
            status !== 'connecting' &&
            status !== 'reconnecting' && (
              <button className="link" onClick={reconnect} type="button">
                Retry
              </button>
            )}
        </div>
      )}
    </>
  );

  return compact ? (
    content
  ) : (
    <main className="shell">
      <section
        className="card wide live-surface"
        ref={stageRef}
        aria-labelledby="live-title"
      >
        {content}
      </section>
    </main>
  );
}
