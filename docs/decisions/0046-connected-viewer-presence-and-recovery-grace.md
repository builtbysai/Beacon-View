# ADR 0046: Connected viewer presence and transient recovery grace

Date: September 12, 2026

## Status

Accepted for the private alpha.

## Context

Production signaling diagnostics showed otherwise healthy live sessions being replaced
after WebRTC briefly entered `disconnected`. That state can recover without a new offer,
but the web viewer treated it like terminal `failed` and immediately closed signaling.
The backend also counted admitted, still-negotiating sessions as viewers and published no
household event when a viewer became connected or left, leaving UI counts temporarily
inflated or stale until the next inventory refresh.

## Decision

The web viewer gives a transient WebRTC `disconnected` state eight seconds to recover on
the existing peer connection. `failed`, `closed`, signaling failure, authorization loss,
and an expired grace period still use the bounded reconnect policy. Talk capture continues
to stop immediately on signaling failure; the grace period does not keep microphone
capture active.

The signaling hub records whether each admitted session has reached device-confirmed
`connected`. Public viewer counts and viewer connection IDs include only those connected
sessions. A household camera-state event is published when a session first becomes
connected and when that connected session is removed, causing authenticated clients to
refresh counts immediately. Negotiating sessions remain internally bounded by the
existing negotiation timeout.

## Consequences

- Brief Wi-Fi or route transitions no longer force avoidable full renegotiation.
- Viewer badges describe established viewing sessions rather than pending handshakes.
- Counts converge through immediate events while periodic inventory refresh remains a
  fallback.
- A genuinely dead peer may remain visually frozen for at most eight seconds before the
  existing reconnect sequence begins.
