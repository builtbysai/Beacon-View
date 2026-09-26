# Cross-platform and IoT research: IP cameras, iOS, and desktop clients

Updated September 26, 2026. This is design research only, requested alongside beginning the
smart-detection foundation (ADR 0073). It does not implement, enable, or approve anything.
Per `docs/roadmap.md`'s "Later / deferred" table, IP cameras, other native clients, and
cloud-synced workspaces each require their own approved design milestone; ADR 0067 already
sets the requirements before any IoT adapter is enabled. Nothing here starts that milestone.

## Summary recommendation

If any of this is pursued, in cost/risk order:

1. **iOS and desktop as a viewer**, via an installed Progressive Web App -- near-zero
   incremental cost, reuses the existing web-viewer/service-worker work almost unchanged.
2. **ONVIF/RTSP IP-camera bridging** -- real new capability, but a materially different
   threat model than the Android agent Beacon fully controls; needs its own protocol and
   credential-storage ADR per ADR 0067 before any server-side network access.
3. **A native iOS or desktop camera agent** -- the most expensive option and, for iOS
   specifically, constrained by a platform capability gap described below. Lowest
   incremental value once (1) and (2) exist.

## IP cameras and IoT devices

### Protocol landscape

Most consumer and prosumer IP cameras and NVRs speak **ONVIF** for discovery and control:

- Discovery via WS-Discovery (multicast on the LAN).
- Control/configuration via a SOAP-based device/media API.
- **Profile S** covers live streaming and PTZ; **Profile T** adds H.265 and richer motion
  metadata. Camera support for either profile varies widely by vendor and firmware age.
- The actual media transport is almost always **RTSP** carrying H.264 or H.265 over RTP --
  not WebRTC, and not something a browser can play directly.

A smaller, growing set of devices (mainly newer commercial-grade cameras) speak WebRTC
natively (WHEP/WHIP), which would not need a bridge at all. Assume the common case is
ONVIF/RTSP unless a specific device is confirmed otherwise.

### Bridging RTSP into Beacon's WebRTC viewer

Beacon's web viewer only speaks WebRTC. An ONVIF/RTSP camera needs a local media bridge:

- **MediaMTX** (formerly `rtsp-simple-server`) and **go2rtc** are the two mature, actively
  maintained, open-source options that convert RTSP (and other inputs) to WebRTC. Both are
  boring, well-established projects with permissive licenses, consistent with the "prefer
  mature dependencies" rule.
- This adds a new always-on local service per household (or one shared instance), which is
  new infrastructure and a new cost/ops line -- unlike Beacon's current architecture, where
  the camera device itself is the only new compute the user provides.
- The bridge needs the camera's RTSP credentials, so it becomes a place where those
  credentials are held and could leak; this is exactly the "credential storage, rotation,
  and revocation" question ADR 0067 already flags as a prerequisite.

### Threat model is materially different from the Android agent

Beacon currently trusts its own Kotlin code end to end. An IP camera is firmware Beacon does
not control, from a vendor Beacon has not vetted:

- Long, well-documented history of default or weak credentials, unpatched firmware, and
  exposed vendor cloud/P2P relays (common on generic OEM "smart" cameras that phone out to a
  vendor's own cloud regardless of local network settings). Any such vendor-cloud transport
  should be explicitly excluded -- the existing `DeviceTransport` contract in
  `packages/shared-types/src/device-integration.ts` already models `'local-network'` vs.
  `'vendor-cloud'`, and only `'local-network'` devices should ever be considered.
- Many ONVIF/RTSP devices support only Digest or WS-Security authentication, weaker than the
  token-based auth Beacon's own backend uses, and a meaningful fraction expose RTSP with no
  authentication at all if left at factory defaults.
- **Capture-visible indicator equivalence is a real gap, not a formality.** Beacon's core
  privacy promise (product principle 8; ADR 0067 requirement 2) is that capture is visible at
  the source and privacy mode stops it immediately. Many dumb IP cameras have no local
  indicator LED at all, or one that firmware can disable without the owner's knowledge. A
  camera class that cannot prove an equivalent, tamper-resistant visible-capture indicator
  cannot become a Beacon camera source under ADR 0067's requirement 2 -- this is a hardware
  selection constraint, not something Beacon's software can compensate for.

### If pursued

Scope to Profile S ONVIF over RTSP, local-network transport only, one vendor/model at a time
starting with a protocol-conformant simulator before real hardware (ADR 0067 requirement 5).
Treat the bridge (MediaMTX/go2rtc) as a new deployed service requiring its own hosting,
patching, and credential-handling review -- not a client-side library change.

## iOS

### Camera role: a real platform constraint, not just engineering effort

Beacon's product promise is turning "an unused phone" into an always-on camera via Android's
foreground-service model, which permits sustained background camera/microphone capture with a
persistent, user-visible notification. **iOS does not offer an equivalent.** Background
camera capture on iOS is heavily restricted; an iOS camera agent would need to stay
foregrounded (screen on, app in front) far more than Android does, which conflicts directly
with the "leave an old phone somewhere as a camera" use case. This is an Apple platform
policy boundary, not a resource-allocation problem -- more engineering time does not remove
it. Any iOS camera-agent proposal must confront this constraint explicitly before scoping
further.

### Viewer role: comparatively cheap

An iOS **viewer** does not have this problem, and iOS 16.4+ Safari supports Web Push for an
installed (added-to-home-screen) PWA. Beacon's web viewer is already a PWA with a service
worker (`docs/development-handoff.md`, "installable, background-capable notification
behavior"). Supporting iOS as a viewer is largely a matter of verifying that existing PWA
install/push flow on iOS Safari, not building a new client.

### If a native iOS app is pursued anyway

It would need Swift/SwiftUI, AVFoundation for capture, and a WebRTC iOS SDK (Google's
official `WebRTC.xcframework` distribution is the mature option). The existing Fastify
WebSocket signaling and STUN/TURN contract would not need to change -- only a new client
speaking the same protocol. New recurring costs: Apple Developer Program membership, code
signing/provisioning, and App Store review (camera/microphone usage strings and Apple's
privacy "nutrition label" disclosures, which must stay honest with ADR 0031/threat-model
language). Push would use APNs rather than FCM if ever needed outside the existing Web Push
path.

## Desktop (Windows, macOS, Linux)

### Viewer role: mostly already solved

The current responsive web viewer plus its PWA manifest and service worker already installs
on desktop Chrome/Edge on all three OSes. A "native" desktop client mainly buys OS-level
notification integration outside the browser, a system tray icon, and auto-launch-at-login --
incremental ergonomics, not new capability.

### Camera role: mostly already solved too

Any of these OSes can already act as a camera source today through the existing **Browser
Camera Mode** (`docs/browser-camera-mode.md`) using `getUserMedia` in a browser tab. A native
wrapper would mainly remove the "keep a browser tab open" ergonomic tax rather than add
fundamentally new capability, since the media path is the same browser-producer flow that
already exists.

### If a thin native wrapper is pursued

Prefer **Tauri** (Rust-based, small binary, no bundled Chromium runtime) over Electron for a
wrapper around the existing PWA, consistent with the "boring, mature technology" and
cost-conscious preferences -- Electron's bundled-runtime footprint and update size are a
recurring cost and maintenance burden Tauri avoids. This still introduces new distribution
surface (installers, code-signing certificates, auto-update infrastructure) that did not
exist before and should not be started without an explicit owner decision on that recurring
cost, per the roadmap's "Cross-platform installed clients" row.

## What this research does not decide

- Whether to pursue any of this at all. Each remains in `docs/roadmap.md`'s deferred table.
- Which specific IP-camera vendor or model to target first.
- Hosting/cost ownership for a MediaMTX/go2rtc bridge, or code-signing cost ownership for
  native iOS/desktop distribution.
- Any change to `packages/shared-types/src/device-integration.ts`'s planning-only contract.

## Sources

- [ONVIF specifications and conformance profiles](https://www.onvif.org/profiles/)
- [MediaMTX](https://github.com/bluenviron/mediamtx)
- [go2rtc](https://github.com/AlexxIT/go2rtc)
- [Apple: Preparing your app to work in the background](https://developer.apple.com/documentation/xcode/configuring-background-execution-modes)
- [WebKit: Web Push for web apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Google WebRTC iOS/macOS prebuilt binaries](https://webrtc.github.io/webrtc-org/native-code/ios/)
- [Tauri](https://tauri.app/)
