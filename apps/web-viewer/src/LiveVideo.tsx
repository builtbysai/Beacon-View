import { useCallback, useEffect, useRef, useState } from 'react';

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
  | { code: string; type: 'error' | 'peer-left' };

type ConnectionStatus =
  'connected' | 'connecting' | 'reconnecting' | ConnectionFailure;

function signalingUrl(cameraId: string): string {
  const url = new URL('/api/signaling', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('role', 'viewer');
  url.searchParams.set('cameraId', cameraId);
  return url.toString();
}

export function LiveVideo({
  camera,
  onBack,
}: {
  camera: Camera;
  onBack: () => void;
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

  const reconnect = useCallback(() => {
    retryCount.current = 0;
    setRetryDisplay(0);
    generation.current.cancel();
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    setStatus('connecting');
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
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
      window.clearTimeout(timeout);
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
        peer.ontrack = (trackEvent) => {
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
          if (peer.connectionState === 'connected') {
            window.clearTimeout(timeout);
            retryCount.current = 0;
            setRetryDisplay(0);
            setStatus('connected');
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
        for (const candidate of pendingIce.current.splice(0)) {
          await peer.addIceCandidate(candidate);
        }
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
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
  }, [attempt, camera.id]);

  useEffect(
    () => () => {
      generation.current.cancel();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    },
    [],
  );

  return (
    <main className="shell">
      <section className="card wide" aria-labelledby="live-title">
        <div className="heading">
          <div>
            <p className="eyebrow">Live video</p>
            <h1 id="live-title">{camera.name}</h1>
          </div>
          <button className="secondary" onClick={onBack}>
            Back to cameras
          </button>
        </div>
        <div className="video-frame">
          <video ref={videoRef} autoPlay playsInline muted />
        </div>
        <p role="status">Connection: {status}</p>
        <p className="notice">Reconnect attempts: {retryDisplay}</p>
        {status !== 'connected' &&
          status !== 'connecting' &&
          status !== 'reconnecting' && (
            <button onClick={reconnect}>Reconnect</button>
          )}
        <p className="notice">
          Closing this view ends only your viewer session. The camera remains
          online and ready for the next authorized viewer. Audio and recording
          are disabled.
        </p>
      </section>
    </main>
  );
}
