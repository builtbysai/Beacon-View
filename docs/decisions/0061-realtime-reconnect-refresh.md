# ADR 0061: Refresh household state after event-channel recovery

Status: Accepted, September 23, 2026

## Context

The household WebSocket reconnects after a network loss, but events published
while it was disconnected are not replayed. The Home inventory and motion
history could therefore remain stale until another event or manual action.

## Decision

After an ordinary disconnect, refresh camera/device inventory, motion history,
and membership views when the replacement socket receives its subscription
confirmation. A deliberate 4002 grant or household refresh still refreshes
immediately and does not repeat the work on subscription. Initial connection
does not trigger a redundant refresh. Existing targeted updates for live events
remain in place.

## Consequences

A recovered connection may make a few read requests, once per recovery. The
server does not need event replay or a new snapshot endpoint for this scope.
The event channel remains administrator-only; viewer and guest realtime
delivery needs its own grant-filtered server contract.
