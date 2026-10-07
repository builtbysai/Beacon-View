import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { CameraFlipButton } from './CameraFlipButton';
import { InlineRename } from './InlineRename';
import { OverflowMenu } from './OverflowMenu';
import { TalkSession, type TalkState } from './talk';
import {
  liveOverlay,
  talkStatusText,
  type ConnectionStatus,
} from './live-video-presentation';
import {
  readStreamQuality,
  type PreviousInboundBytes,
  type StreamQuality,
} from './live-video-quality';
import { RecordingBadge } from './RecordingBadge';
import { useClipRecorder } from './useClipRecorder';
import {
  DRIVE_READY,
  type DriveRecording,
  isDriveProblem,
} from './drive-recording';
import { DriveReconnectNotice, RecordClipControl } from './RecordClipControl';
import { randomUuid } from './random-id';

import {
  type ConnectionFailure,
  mayRetry,
  RetryGeneration,
  retryDelay,
} from './reconnect';
import './LiveVideo.css';

interface Camera {
  id: string;
  name: string;
  /** A baby monitor opens with sound (ADR 0084). */
  useCase?: string;
}

interface ReadyMessage {
  canListen?: boolean;
  canTalk?: boolean;
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
      reason?: 'busy' | 'not_allowed';
      type: 'talk-state';
    }
  | { code: string; type: 'error' | 'peer-left' };

function signalingUrl(cameraId: string, viewerSessionId: string): string {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'viewer');
  url.searchParams.set('cameraId', cameraId);
  url.searchParams.set('viewerSessionId', viewerSessionId);
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
  onRename,
  onDelete,
  canRecord = false,
  drive = DRIVE_READY,
  canFlip = true,
  canPause = true,
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
  onRename?: (name: string) => void;
  onDelete?: () => void;
  /** Only the household owner can request recordings (see POST
   * /api/recordings) -- the control is hidden rather than shown disabled
   * for everyone else, matching how Listen/Talk grants already work. */
  canRecord?: boolean;
  /** Whether Google Drive is connected with the recording scope granted.
   * When it isn't, the record control becomes a link to go connect it
   * instead of a button that always fails with a 409 once pressed. */
  /** Whether recordings can be saved, and how to connect Drive. */
  drive?: DriveRecording;
  /** Whether this camera's grant allows switching between its sibling
   * sources. Hidden, not disabled, when it doesn't -- same as Listen/Talk. */
  canFlip?: boolean;
  /** Whether this camera's grant allows toggling privacy mode. */
  canPause?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const generation = useRef(new RetryGeneration());
  // One id per continuous viewing attempt: stable across this attempt's own
  // automatic reconnects (so access-history can group them), regenerated
  // when the viewer deliberately starts a fresh attempt (mount, switching
  // cameras, or clicking Reconnect).
  const viewerSessionId = useRef(randomUuid());
  const previousCameraId = useRef<string | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [retryDisplay, setRetryDisplay] = useState(0);
  const [quality, setQuality] = useState<StreamQuality | null>(null);
  const [listening, setListening] = useState(false);
  // Whether the camera actually sends sound on this connection (null until
  // negotiated). A camera always offers an audio section for Talk, but only
  // sends its own sound when it shares it.
  const [cameraSound, setCameraSound] = useState<boolean | null>(null);
  const [permissions, setPermissions] = useState({
    canListen: true,
    canTalk: true,
  });
  const [talkState, setTalkState] = useState<TalkState>('idle');
  const talkSession = useRef<TalkSession | null>(null);
  const qualityTimer = useRef<number | null>(null);
  const previousBytes = useRef<PreviousInboundBytes | null>(null);
  const stageRef = useRef<HTMLElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlError, setControlError] = useState('');
  const [switching, setSwitching] = useState(false);
  const switchInProgress = useRef(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const playbackGeneration = useRef(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const hideControlsTimer = useRef<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const clip = useClipRecorder(camera.id);
  // Matches CameraTile's grouped-by-host convention: the device is the
  // user-facing "camera", so its name leads; the source's own name (e.g.
  // "Rear camera") is secondary and only shown when it actually differs.
  const primaryName = deviceName || camera.name;
  const overlay = liveOverlay(status, videoReady, switching, retryDisplay);
  // The backend's viewerCount includes this very session once its own
  // WebRTC connection is up, so "watching now" needs to subtract it back
  // out -- otherwise watching alone always misreports as "1 viewer".
  const othersWatching = Math.max(
    0,
    viewerCount - (status === 'connected' ? 1 : 0),
  );

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current !== null)
      window.clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = window.setTimeout(
      () => setControlsVisible(false),
      3_000,
    );
  }, []);

  const startRecording = useCallback(() => {
    const stream = videoRef.current?.srcObject;
    const isMediaStream =
      typeof MediaStream !== 'undefined' && stream instanceof MediaStream;
    if (!isMediaStream) {
      setControlError('Recording is not available yet -- still connecting.');
      return;
    }
    setControlError('');
    clip.start(stream);
  }, [clip]);

  // A Drive problem has its own notice with a fix; others show here.
  useEffect(() => {
    if (clip.state.error && !isDriveProblem(clip.state.errorCode))
      setControlError(clip.state.error);
  }, [clip.state.error, clip.state.errorCode]);

  // Clears a finished clip's status back to the plain "Record a short
  // clip" control a few seconds after it lands, the same pause the old
  // request-and-poll version gave someone to read "Recording saved".
  useEffect(() => {
    if (clip.state.status !== 'available') return;
    const timer = window.setTimeout(() => clip.reset(), 6_000);
    return () => window.clearTimeout(timer);
  }, [clip.reset, clip.state.status]);

  // A manual recording captures whatever this session receives over
  // WebRTC. If that connection drops mid-recording, finishing it would
  // just upload a broken clip -- abort it as a real, explained failure
  // instead of silently continuing against a dead stream.
  useEffect(() => {
    if (clip.state.status !== 'recording' || status === 'connected') return;
    clip.abort(
      'Recording stopped because the connection to the camera was lost.',
    );
  }, [clip, status]);

  useEffect(
    () => () => {
      if (hideControlsTimer.current !== null)
        window.clearTimeout(hideControlsTimer.current);
    },
    [],
  );

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
    viewerSessionId.current = randomUuid();
    setStatus('connecting');
    setAttempt((value) => value + 1);
  }, []);

  function setAudio(next: boolean) {
    const current = ++playbackGeneration.current;
    setControlError('');
    setListening(next);
    if (!videoRef.current) return;
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

  // A baby monitor opens with sound (ADR 0084). If the browser's autoplay
  // policy refuses, video keeps playing muted and the person taps Listen.
  const autoListened = useRef<string | null>(null);
  useEffect(() => {
    if (
      !videoReady ||
      cameraSound !== true ||
      camera.useCase !== 'baby' ||
      !permissions.canListen ||
      autoListened.current === camera.id
    )
      return;
    autoListened.current = camera.id;
    setAudio(true);
    // setAudio only touches refs and setters; rerun only when these change.
  }, [
    videoReady,
    cameraSound,
    camera.id,
    camera.useCase,
    permissions.canListen,
  ]);

  useEffect(() => {
    setQuality(null);
    setVideoReady(false);
    setListening(false);
    setCameraSound(null);
    setPermissions({ canListen: true, canTalk: true });
    if (!enabled || privacyMode) {
      setStatus(privacyMode ? 'privacy on' : 'stream unavailable');
      return;
    }
    setStatus((current) =>
      current === 'reconnecting' ? current : 'connecting',
    );
    if (previousCameraId.current !== camera.id) {
      viewerSessionId.current = randomUuid();
      previousCameraId.current = camera.id;
    }
    const currentGeneration = generation.current.next();
    let active = true;
    let completed = false;
    let disconnectGraceTimer: number | null = null;
    const socket = new WebSocket(
      signalingUrl(camera.id, viewerSessionId.current),
    );
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
      if (disconnectGraceTimer !== null)
        window.clearTimeout(disconnectGraceTimer);
      disconnectGraceTimer = null;
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
        setPermissions({
          canListen: message.canListen !== false,
          canTalk: message.canTalk !== false,
        });
        connectionIdRef.current = message.connectionId;
        const peer = new RTCPeerConnection({
          iceServers: message.iceServers,
          iceTransportPolicy: message.iceTransportPolicy,
        });
        peerRef.current = peer;
        // A fresh TalkSession always starts idle, but its constructor never
        // calls onState -- without this, a reconnect leaves talkState stuck
        // on whatever the disposed prior session last reported (typically
        // 'recovering', so the "Microphone off · reconnecting" label would
        // hang forever even after the connection came back).
        setTalkState('idle');
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
            if (disconnectGraceTimer !== null)
              window.clearTimeout(disconnectGraceTimer);
            disconnectGraceTimer = null;
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
          } else if (peer.connectionState === 'disconnected') {
            if (disconnectGraceTimer === null) {
              disconnectGraceTimer = window.setTimeout(() => {
                disconnectGraceTimer = null;
                fail('signaling unavailable');
              }, 8_000);
            }
          } else if (
            peer.connectionState === 'failed' ||
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
        setCameraSound(
          peer
            .getTransceivers()
            .some(
              (transceiver) =>
                transceiver.receiver.track.kind === 'audio' &&
                (transceiver.currentDirection === 'recvonly' ||
                  transceiver.currentDirection === 'sendrecv'),
            ),
        );
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
      const sample = readStreamQuality(report, previousBytes.current);
      if (!sample) return;
      previousBytes.current = sample.previous;
      setQuality(sample.quality);
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

  function switchCamera(cameraId: string) {
    if (switchInProgress.current || cameraId === camera.id) return;
    switchInProgress.current = true;
    talkSession.current?.stop();
    setSwitching(true);
    setControlError('');
    void Promise.resolve()
      .then(() => onSelectCamera?.(cameraId))
      .catch(() =>
        setControlError(
          'The camera could not switch. Your current view remains selected. Try again.',
        ),
      )
      .finally(() => {
        switchInProgress.current = false;
        setSwitching(false);
      });
  }

  const content = (
    <>
      <div
        className="video-frame"
        onFocus={!compact ? wakeControls : undefined}
        onPointerDown={!compact ? wakeControls : undefined}
        onPointerMove={!compact ? wakeControls : undefined}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={!listening}
          onLoadedData={() => setVideoReady(true)}
          onPlaying={() => setVideoReady(true)}
        />
        {!compact && (
          <div className="video-top-scrim">
            <button
              aria-label="Back"
              className="video-back"
              onClick={onBack}
              type="button"
            >
              <Icon name="chevronLeft" />
            </button>
            <div className="video-identity">
              <div className="video-badges-row">
                <span
                  className={`video-live-badge${
                    status === 'connected' && videoReady ? ' is-live' : ''
                  }`}
                >
                  {status === 'connected'
                    ? videoReady
                      ? 'LIVE'
                      : 'STARTING'
                    : status.toUpperCase()}
                </span>
                <RecordingBadge state={clip.state} />
              </div>
              {renaming ? (
                <InlineRename
                  value={primaryName}
                  ariaLabel={`Rename ${primaryName}`}
                  className="inline-rename-heading"
                  onSubmit={(name) => {
                    setRenaming(false);
                    onRename?.(name);
                  }}
                  onCancel={() => setRenaming(false)}
                />
              ) : (
                <h1 id="live-title">{primaryName}</h1>
              )}
              {camera.name !== primaryName && <span>{camera.name}</span>}
            </div>
            {onDevice && !onRename && !onDelete && !renaming && (
              <button
                aria-label="Camera settings"
                className="video-settings-button"
                onClick={onDevice}
                type="button"
              >
                <Icon name="settings" />
              </button>
            )}
            {(onRename || onDelete) && !renaming && (
              <OverflowMenu
                label={`${primaryName} options`}
                menuClassName="camera-tile-menu camera-tile-menu-below"
              >
                {(close) => (
                  <>
                    {onRename && (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          close();
                          setRenaming(true);
                        }}
                      >
                        <Icon name="edit" />
                        Rename
                      </button>
                    )}
                    {onDelete && (
                      <button
                        role="menuitem"
                        type="button"
                        className="camera-tile-menu-danger"
                        onClick={() => {
                          close();
                          onDelete();
                        }}
                      >
                        <Icon name="trash" />
                        Remove camera
                      </button>
                    )}
                  </>
                )}
              </OverflowMenu>
            )}
          </div>
        )}
        {overlay && (
          <div className="video-overlay">
            <strong>{overlay.title}</strong>
            <span>{overlay.detail}</span>
          </div>
        )}
        {!compact && (
          <div
            aria-label="Live view controls"
            className={`video-controls${controlsVisible ? ' is-visible' : ''}`}
          >
            {permissions.canListen && (
              <button
                aria-pressed={listening}
                className="video-control"
                disabled={cameraSound === false}
                title={
                  cameraSound === false
                    ? 'This camera isn’t sharing sound. Turn on “Include sound” on that camera.'
                    : listening
                      ? 'Mute camera audio'
                      : 'Listen to camera'
                }
                onClick={() => setAudio(!listening)}
                type="button"
              >
                <Icon name={listening ? 'speaker' : 'speakerOff'} />
                <span className="visually-hidden">
                  {listening ? 'Mute' : 'Listen'}
                </span>
              </button>
            )}
            {permissions.canTalk && (
              <button
                aria-pressed={talkState === 'speaking'}
                className={`video-control${talkState === 'speaking' ? ' is-active' : ''}`}
                title={
                  talkState === 'speaking'
                    ? 'Stop talking'
                    : 'Talk through camera'
                }
                disabled={
                  switching ||
                  privacyBusy ||
                  privacyMode ||
                  (status !== 'connected' &&
                    !['permission', 'connecting', 'speaking'].includes(
                      talkState,
                    ))
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
                <Icon name={talkState === 'speaking' ? 'micOff' : 'mic'} />
                <span className="visually-hidden">
                  {talkState === 'speaking'
                    ? 'Stop talking'
                    : talkState === 'permission' || talkState === 'connecting'
                      ? 'Cancel talk'
                      : 'Talk'}
                </span>
              </button>
            )}
            {canFlip && (
              <CameraFlipButton
                sources={siblingCameras}
                activeId={camera.id}
                busy={switching || privacyBusy || privacyMode}
                className="video-control"
                onSwitch={switchCamera}
              />
            )}
            {onPrivacy && canPause && (
              <button
                aria-pressed={privacyMode}
                className={`video-control${privacyMode ? ' is-active' : ''}`}
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
                <Icon name="lock" />
                <span className="visually-hidden">
                  {privacyBusy
                    ? 'Updating privacy…'
                    : privacyMode
                      ? 'Resume'
                      : 'Pause'}
                </span>
              </button>
            )}
            {canRecord && (
              <RecordClipControl
                className="video-control"
                clip={clip}
                disabled={privacyMode || status !== 'connected'}
                drive={drive}
                onStart={startRecording}
              />
            )}
            <button
              className="video-control"
              title={fullscreen ? 'Exit full screen' : 'Full screen'}
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
              <Icon name={fullscreen ? 'minimize' : 'maximize'} />
              <span className="visually-hidden">
                {fullscreen ? 'Exit full screen' : 'Full screen'}
              </span>
            </button>
          </div>
        )}
        {!compact && (quality || othersWatching > 0) && (
          <button
            aria-expanded={statsOpen}
            aria-label={`Stream details: ${othersWatching} other ${
              othersWatching === 1 ? 'viewer' : 'viewers'
            }${quality ? `, ${quality.path}` : ''}`}
            className={`video-stats-toggle${
              controlsVisible || statsOpen ? ' is-visible' : ''
            }`}
            onClick={() => setStatsOpen((open) => !open)}
            type="button"
          >
            <Icon name={othersWatching > 0 ? 'eye' : 'signal'} />
            <span>
              {othersWatching > 0
                ? `${othersWatching} other ${othersWatching === 1 ? 'viewer' : 'viewers'}`
                : 'Stream details'}
            </span>
          </button>
        )}
        {!compact && statsOpen && (
          <div className="video-stats-panel">
            <div className="viewer-roster" aria-label="Active viewers">
              <strong>
                {othersWatching === 0
                  ? 'No one else is watching'
                  : 'Watching now'}
              </strong>
              {status === 'connected' && (
                <span>
                  <Icon name="eye" />
                  You
                </span>
              )}
              {Array.from({ length: othersWatching }, (_, index) => (
                <span key={index}>
                  <Icon name="eye" />
                  {`Household viewer ${index + 1}`}
                </span>
              ))}
              <small>Viewer names stay private in this live view.</small>
            </div>
            {quality && (
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
            )}
          </div>
        )}
      </div>
      <p className="visually-hidden" role="status">
        Connection: {status}
      </p>
      {!compact && canRecord && (
        <DriveReconnectNotice className="on-video" clip={clip} drive={drive} />
      )}
      {!compact && (controlError || talkState !== 'idle') && (
        <div className="live-footer">
          {controlError && (
            <p role="alert">
              {controlError}
              {clip.state.status === 'failed' && (
                <button
                  className="link"
                  onClick={() => {
                    clip.reset();
                    setControlError('');
                  }}
                  type="button"
                >
                  Discard clip
                </button>
              )}
            </p>
          )}
          {talkState !== 'idle' && (
            <p
              className="live-talk-status"
              role="status"
              aria-label="Talk status"
            >
              {talkStatusText(talkState)}
            </p>
          )}
          {enabled &&
            !privacyMode &&
            status !== 'connected' &&
            status !== 'connecting' &&
            status !== 'reconnecting' && (
              <button onClick={reconnect}>Reconnect</button>
            )}
        </div>
      )}
      {compact && (
        <div className="tile-controls">
          <span
            className={
              status === 'connected' && videoReady ? 'streaming' : 'offline'
            }
          >
            {status === 'connected'
              ? videoReady
                ? 'LIVE'
                : 'STARTING VIDEO'
              : status.toUpperCase()}
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
    <main className="live-shell" ref={stageRef} aria-labelledby="live-title">
      {content}
    </main>
  );
}
