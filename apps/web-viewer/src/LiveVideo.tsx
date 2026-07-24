import { useCallback, useEffect, useRef, useState } from 'react';

interface Camera {
  id: string;
  name: string;
}

interface ReadyMessage {
  connectionId: string;
  iceServers: RTCIceServer[];
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

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'failed';

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
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [attempt, setAttempt] = useState(0);

  const reconnect = useCallback(() => {
    setStatus('connecting');
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const socket = new WebSocket(signalingUrl(camera.id));
    socketRef.current = socket;

    async function handleMessage(event: MessageEvent) {
      if (!active) return;
      if (typeof event.data !== 'string') throw new Error('Invalid message');
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'error' || message.type === 'peer-left') {
        setStatus('failed');
        peerRef.current?.close();
        return;
      }
      if (message.type === 'ready') {
        connectionIdRef.current = message.connectionId;
        const peer = new RTCPeerConnection({ iceServers: message.iceServers });
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
            setStatus(
              peer.connectionState === 'disconnected'
                ? 'disconnected'
                : 'failed',
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
      void handleMessage(event).catch(() => setStatus('failed'));
    };
    socket.onerror = () => setStatus('failed');
    socket.onclose = () => {
      if (active) setStatus('failed');
    };

    return () => {
      active = false;
      const connectionId = connectionIdRef.current;
      if (connectionId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ connectionId, type: 'disconnect' }));
      }
      socket.close();
      peerRef.current?.close();
      socketRef.current = null;
      peerRef.current = null;
      connectionIdRef.current = null;
      pendingIce.current = [];
    };
  }, [attempt, camera.id]);

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
        {(status === 'failed' || status === 'disconnected') && (
          <button onClick={reconnect}>Reconnect</button>
        )}
        <p className="notice">
          Video is live only while this page and the camera app are open. Audio
          and recording are disabled.
        </p>
      </section>
    </main>
  );
}
