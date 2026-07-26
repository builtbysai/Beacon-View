# ADR 0010: Local monitoring workspaces

## Status

Accepted for Milestone 9.

## Context

Multi-camera monitoring needs named camera selections, layout capacity, ordering,
and refresh preferences. The backend has no workspace entity or approved
cross-device sharing and conflict semantics. Viewer signaling is already
connection-scoped and supports independent tile lifecycles.

## Decision

Compose the existing WebRTC viewer lifecycle once per visible camera tile. Use
stable camera-source IDs as React keys so reorder and filtering preserve
unaffected sessions. Suspend distant tiles by default with IntersectionObserver
and suspend all monitoring sessions while the browser document is hidden.

Store a versioned workspace model in browser localStorage under the authenticated
user's public ID. Store only workspace names, public camera-source IDs, ordering,
layout capacity, and refresh/fullscreen preferences. Do not store credentials,
signaling data, media, household IDs, or diagnostics.

Use application-level expanded tiles instead of the browser Fullscreen API so
camera context, source switching, device navigation, and Escape handling remain
consistent.

## Consequences

Workspaces are private to one browser profile and do not synchronize. This is
explicit in the UI documentation. A future server-backed model requires
approved household authorization, limits, audit behavior, and merge semantics.
Sixteen direct viewer sessions may exceed producer or network capacity; this
decision does not claim a supported production maximum or introduce an SFU.
