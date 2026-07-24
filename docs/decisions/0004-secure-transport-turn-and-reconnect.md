# ADR 0004: Secure transport, ephemeral TURN, and bounded reconnect

- Status: accepted
- Date: 2026-07-24

## Context

The Milestone 2 video path used development HTTP and static local TURN
credentials and had only basic reconnect behavior. Physical-device and realistic
network testing require trusted HTTPS/WSS, relay fallback, revocation handling,
and deterministic cleanup without adding deployment automation.

## Decision

Production configuration requires HTTPS/WSS and exact Origin validation. An
explicit development flag is the only path to HTTP/WS. A profile-scoped local
Caddy proxy supports trusted development certificates without committing keys
or disabling client verification.

Coturn uses its REST shared-secret mode. After viewer or device authorization,
the backend creates a participant-specific username containing a ten-minute Unix
expiry and an HMAC-SHA1 Base64 credential. Clients receive only validated,
server-controlled STUN/TURN UDP/TCP URLs and ICE policy. Relay-only mode is an
explicit diagnostic setting.

Browser and Android retries use bounded exponential backoff with jitter and
connection generations that invalidate stale work. Active signaling
authorization is periodically rechecked. Android capture and signaling stop with
the foreground streaming screen.

## Consequences

The backend and Coturn must share a protected, rotated secret. Existing WebRTC
media remains peer-to-peer or encrypted through TURN; the backend remains
signaling-only. The local CA requires explicit trust on each test device.
Signaling is still single-instance and active revocation is bounded by the
authorization-check interval.
