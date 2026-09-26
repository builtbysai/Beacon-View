# ADR 0076: ONVIF/RTSP IP-camera protocol selection and threat model

Date: 2026-09-26

## Status

Proposed. This satisfies ADR 0067's requirement 1 ("select a device class and
protocol, document its threat model and authentication flow") only. It does
not enable, build, or authorize an adapter. Per ADR 0067, requirements 2-5
(capture-indicator proof, least-privilege scopes, a reviewed household/
platform migration, and real-hardware-or-simulator testing) all remain open
and are listed below as explicit prerequisites, not implied by this ADR.

The owner selected IP-camera bridging as the track to explore, with no
specific vendor hardware in hand yet -- this is exploratory design, matching
how ADR 0073 began the smart-detection experiment before any device was
available.

## Device class and protocol

**Device class:** ONVIF Profile S conformant IP cameras and NVRs on the same
local network as the household -- the common case for consumer/prosumer IP
cameras per `docs/cross-platform-and-iot-research.md`. Profile T (H.265, richer
metadata) is out of scope for a first design; support it later only if a real
device needs it.

**Discovery and control:** WS-Discovery (multicast) to find devices, then
ONVIF's SOAP-based Device and Media services to read device capabilities and
obtain the camera's RTSP stream URI. This is a request/response control-plane
protocol, not the media path itself.

**Media transport:** RTSP carrying H.264 over RTP -- not WebRTC. Beacon's
viewer only speaks WebRTC, so a local media bridge is required (see
"Architecture" below); nothing about this ADR changes the viewer.

**Explicitly excluded:** any camera whose primary transport is a vendor cloud
/ P2P service rather than direct LAN access. The existing
`packages/shared-types/src/device-integration.ts` planning contract already
models this as `DeviceTransport = 'local-network' | 'vendor-cloud'`; only
`'local-network'` is in scope here. A camera that requires phoning home to a
vendor server for setup or streaming is a different, larger threat-model
problem (Beacon would be trusting that vendor's infrastructure, not just its
firmware) and needs its own separate decision if ever pursued.

## Threat model

This is a materially different trust boundary than Beacon's own Android
agent, which is Beacon's own code end to end. An ONVIF/RTSP camera is
third-party firmware Beacon does not control:

- **Weak/default credentials are common.** A large, well-documented fraction
  of consumer IP cameras ship with default or weak credentials, and many
  expose RTSP with no authentication at all if left at factory settings.
  Beacon must never assume a discovered camera is safe to connect to
  automatically; the household member must explicitly supply credentials for
  a specific device they attest they own or are authorized to use, the same
  language already used for QR/pairing setup (see `CameraModeUi.kt`'s
  "Pair only a device you own or are authorized to use").
- **No guaranteed visible capture indicator.** ADR 0067 requirement 2 is a
  hard gate: "For any camera, prove that capture is visible at the physical
  source and that privacy mode stops it immediately. A device that cannot
  meet this requirement cannot be a Beacon camera source." Many IP cameras
  have no local indicator LED, or firmware that can disable one without the
  owner's knowledge. **This ADR does not resolve that gate.** It is a
  hardware-selection constraint each specific camera model must be evaluated
  against individually, not something Beacon's software can compensate for.
  No IP-camera adapter should reach setup UI for a model that hasn't been
  individually verified against this requirement.
- **Weaker authentication than Beacon's own token model.** ONVIF SOAP calls
  typically authenticate via WS-UsernameToken (a hashed password digest, not
  a modern bearer token) or, on older devices, HTTP Digest. RTSP streams
  commonly use HTTP Digest or nothing. Treat the camera's own credentials as
  a weaker secret than a Beacon-issued device credential, store them
  encrypted at rest exactly as other device credentials are, and never reuse
  a camera's credential for anything beyond that single camera's own API
  calls.
- **The bridge, not the camera, becomes Beacon's new attack surface.**
  Whatever component speaks RTSP/ONVIF to the camera and re-serves the media
  as WebRTC now holds the camera's credentials in memory and is a new network
  service. It must run on a trust boundary no more permissive than the
  household's own local network access already requires, and must not be
  reachable from the public internet directly (only via Beacon's existing
  authenticated signaling/session model, same as every other camera source).

## Architecture (design only, not implemented)

A local media bridge -- **MediaMTX** or **go2rtc**, both mature, actively
maintained, open-source RTSP-to-WebRTC converters -- would sit between the
camera and Beacon's existing signaling. This is new infrastructure with a
real, recurring hosting/operational cost, unlike Beacon's current
architecture where the camera device itself is the only new compute a user
provides. Whether this runs per-household, self-hosted by the user, or as a
shared Beacon-operated component is an open, owner-level cost/ops decision --
this ADR does not make it.

## Requirements still open before any adapter exists (ADR 0067, restated)

1. ~~Select protocol and document threat model~~ -- this ADR.
2. Prove, per camera model, a visible and tamper-resistant capture indicator
   equivalent to Beacon's own promise. Unresolved; likely excludes many
   camera models by default.
3. Define least-privilege data/control scopes, retention, deletion, vendor
   (here: camera firmware/bridge) outage behavior, and local-network request
   restrictions.
4. Extend the household authorization model and database platform
   constraints in a reviewed migration.
5. Test against a protocol-conformant ONVIF/RTSP simulator (no real hardware
   is available in this environment) before any real hardware or exposing
   setup UI. A simulator run is explicitly not equivalent to real-hardware
   acceptance and does not close this requirement on its own.
6. An explicit owner decision on the media-bridge hosting/cost model.

## Consequences

Recording this now gives IP-camera work a reviewable starting point without
committing to hosting cost, writing a network-facing service, or touching the
household authorization model yet. It does not move IP cameras out of the
roadmap's deferred table.
