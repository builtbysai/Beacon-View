# 0008: Device management and source handoff

## Status

Accepted.

## Decision

Treat disable, revoke, and delete as separate operations:

- disable preserves credentials and registration while denying viewers;
- revoke invalidates credentials and requires pairing;
- device delete cascades durable registration data;
- source delete uses a removal tombstone so enumeration cannot silently undo an
  explicit user action.

Management actions immediately close affected in-memory signaling sessions.
Source activation is authorized by the backend and sent over the existing
producer socket. Exclusive-capture producers release the old media resource and
reconnect under the target source ID. The live route remains mounted, but the
peer connection is rebuilt because source identities and authorization remain
independent.

Disabled Android and browser producers may keep or re-establish their
authenticated control socket. Viewer authorization still rejects disabled
devices and sources. This permits enablement without clearing credentials or
requiring a manual producer restart.

## Consequences

The design preserves household and source isolation, supports future SFU media
fan-out, and gives deletion durable user intent. It does not preserve the exact
RTCPeerConnection across a source change; doing so would conflate independent
camera identities and complicate authorization. A short `switching source`
state is therefore explicit.
