# ADR 0016: Connection-scoped Talk consent

## Status

Accepted under the production-readiness development authorization.

## Decision

Negotiate the Android-offered return audio channel in the initial web answer,
without acquiring a microphone. Attach and detach the microphone using the existing
sender's `replaceTrack`, preserving video and the server connection identity.
Keep the acquired track disabled until the server grants that connection's talk lock.
Reject grants for other connections and bound waiting for ownership to ten seconds.

One explicit Talk action authorizes capture for that connection only. Stop, navigation,
source switching, transport failure, hiding the page, permission revocation, and
unmount immediately stop tracks and invalidate pending permission work. Recovery
requires a fresh Talk action. Cancel remains available during permission and ownership
requests. Unsupported producers and denied permissions produce an actionable state.

## Evidence and product research

- The [W3C WebRTC specification](https://www.w3.org/TR/webrtc/) defines negotiated
  transceiver direction and track replacement without creating another connection.
  This supports preserving the existing stream while independently controlling Talk.
- [Google Nest's Talk and Listen guidance](https://support.google.com/googlehome/answer/9219455?hl=en)
  uses explicit microphone interaction and camera-side conversation tones. Beacon
  retains these understandable consent cues and independent Listen/Talk controls.
  Automatic microphone restart after interruption is rejected because consent should
  not silently carry across connections.

## Consequences

No media storage, upload service, dependency, or authorization contract is added.
The server remains the talk-lock authority and Android keeps its remote audio gate.
Automated tests cover track lifetime, stale permission results, grant identity,
contention, timeouts, attachment failure, and preservation of the video connection.
These tests do not prove audible speaker output, echo cancellation, Bluetooth routing,
or cross-network compatibility; those remain physical release gates.
