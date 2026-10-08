import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TalkSession } from './talk';

function microphone() {
  const track = {
    kind: 'audio',
    enabled: true,
    readyState: 'live',
    onended: null,
    stop: vi.fn(),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}

function setup(direction: RTCRtpTransceiverDirection = 'sendonly') {
  const replaceTrack = vi.fn().mockResolvedValue(undefined);
  const peer = {
    connectionState: 'connected',
    getTransceivers: () => [
      {
        receiver: { track: { kind: 'audio' } },
        currentDirection: direction,
        sender: { replaceTrack },
      },
    ],
  } as unknown as RTCPeerConnection;
  const send = vi.fn();
  const onState = vi.fn();
  return {
    session: new TalkSession('connection-a', peer, send, onState),
    send,
    onState,
    replaceTrack,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connection-scoped Talk', () => {
  it('opens the microphone only on request and sends audio only after its own grant', async () => {
    const { stream, track } = microphone();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { session, send, replaceTrack, onState } = setup();
    expect(getUserMedia).not.toHaveBeenCalled();
    await session.start();
    expect(track.enabled).toBe(false);
    expect(replaceTrack).toHaveBeenCalledWith(track);
    expect(send).toHaveBeenCalledWith({
      connectionId: 'connection-a',
      type: 'talk-request',
    });
    session.receive({ connectionId: 'another-connection', active: true });
    expect(track.enabled).toBe(false);
    session.receive({ connectionId: 'connection-a', active: true });
    expect(track.enabled).toBe(true);
    expect(onState).toHaveBeenLastCalledWith('speaking');
    session.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(replaceTrack).toHaveBeenLastCalledWith(null);
    expect(send).toHaveBeenLastCalledWith({
      connectionId: 'connection-a',
      type: 'talk-release',
    });
  });

  it.each(['stop', 'dispose'] as const)(
    'stops late permission results after %s',
    async (action) => {
      const { stream, track } = microphone();
      let grant!: (stream: MediaStream) => void;
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: () =>
            new Promise<MediaStream>((resolve) => {
              grant = resolve;
            }),
        },
      });
      const { session, send, replaceTrack } = setup();
      const pending = session.start();
      session[action]();
      grant(stream);
      await pending;
      expect(track.stop).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
      expect(replaceTrack).not.toHaveBeenCalled();
    },
  );

  it('releases capture on interruption and never reacquires it automatically', async () => {
    const { stream, track } = microphone();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const { session, onState } = setup();
    await session.start();
    session.receive({ connectionId: 'connection-a', active: true });
    session.dispose();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(track.enabled).toBe(false);
    expect(onState).toHaveBeenLastCalledWith('recovering');
    await session.start();
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('releases capture when another viewer owns talk or the grant times out', async () => {
    for (const busy of [true, false]) {
      const { stream, track } = microphone();
      vi.stubGlobal('navigator', {
        mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      });
      const { session, onState } = setup();
      await session.start();
      if (busy)
        session.receive({
          connectionId: 'connection-a',
          active: false,
          reason: 'busy',
        });
      else vi.advanceTimersByTime(10_000);
      expect(track.stop).toHaveBeenCalledOnce();
      expect(onState).toHaveBeenLastCalledWith(busy ? 'busy' : 'unavailable');
      session.dispose();
    }
  });

  it('explains permission denial and unsupported producers without retrying capture', async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const unavailable = setup('recvonly');
    await unavailable.session.start();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(unavailable.onState).toHaveBeenLastCalledWith('unavailable');
    const denied = setup();
    await denied.session.start();
    expect(denied.onState).toHaveBeenLastCalledWith('mic_blocked');
    expect(denied.send).not.toHaveBeenCalled();
  });

  it('tells a missing or busy microphone apart from a blocked one', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(
            new DOMException(
              'Could not start audio source',
              'NotReadableError',
            ),
          ),
      },
    });
    const busyMic = setup();
    await busyMic.session.start();
    expect(busyMic.onState).toHaveBeenLastCalledWith('mic_failed');
  });

  it('says when this viewer may not talk through the camera', async () => {
    const { stream } = microphone();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    const { session, onState } = setup();
    await session.start();
    session.receive({
      active: false,
      connectionId: 'connection-a',
      reason: 'not_allowed',
    });
    expect(onState).toHaveBeenLastCalledWith('not_allowed');
    session.dispose();
  });

  it('stops capture if track attachment fails', async () => {
    const { stream, track } = microphone();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    const { session, replaceTrack, send } = setup();
    replaceTrack.mockRejectedValueOnce(new Error('Negotiation required'));
    await session.start();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });
});
