# 0040: Share the web visual language without coupling Android to web code

## Status

Accepted for the Android experience overhaul milestone.

## Context

The Android application already enforced the important capture, privacy, pairing,
and lifecycle rules, but its screens used ad hoc green surfaces and long columns
that no longer matched the responsive web and PWA experience. Rebuilding the
camera or WebRTC layers to achieve visual parity would add unnecessary security
and reliability risk.

## Decision

Android keeps its existing capture service, signaling, credential, privacy, and
account-session boundaries, but replaces the prior Compose presentation in full.
The PWA is the visual and compositional authority: branded page headers, navy home
hero, outlined utility cards, dark camera canvases, semantic status pills, icon-led
controls, fixed bottom navigation, and responsive single-column layouts.

The native design layer defines the same semantic colors as the web application:
navy text, blue actions, neutral surfaces, green online state, red live state,
purple privacy state, amber recovery state, and gray offline state.

Screens compose those tokens into native panels, status pills, metrics, and the
same Home, Cameras, Activity, and Settings navigation used by the mobile PWA.
Camera mode is an explicit, visible operating state rather than a peer tab in the
viewer navigation. Android remains a native client; it does not embed the web
application or share generated presentation code with it.

Camera mode favors terse overlay controls over persistent explanatory text. An
idle, available camera shows a compact green indicator that expands to "Online"
when selected and collapses when focus leaves it. Privacy uses the short actions
"Pause" and "Resume." Bottom navigation draws through the system gesture inset
while keeping its controls inside the safe area, so it visually reaches the edge
on gesture-navigation devices.

The camera switch is visible only while capture is active. Secondary actions live in
one compact Settings menu, with Monitor first and Disconnect as the destructive final
item; clicking outside dismisses the menu. This keeps the live canvas primary and avoids
a large modal for routine navigation or disconnection.

Web, PWA, and Android use one simplified lens-and-signal mark: a cyan lens, symmetric
signal arcs, and a small base on navy. The geometry is shared conceptually across SVG,
adaptive Android vector, monochrome launcher, maskable PWA, Apple touch, and favicon
assets so the identity remains recognizable at both launcher and browser-tab sizes.

The Cameras destination also follows the web device hierarchy: each device card
opens one native details surface for status, live view, camera-source selection,
and privacy mode. Destructive device and source removal remain outside this
visual overhaul until their confirmation and recovery behavior is approved.

One physical host is presented as one camera even when it registers multiple
lenses. A single flip control selects the alternate source. Viewer-initiated
switches use the backend's authenticated source-activation command, so the
camera agent and every connected viewer converge on the same active source.
Locally scanned Beacon QR codes begin pairing immediately after validation;
pairing links opened from another Android QR scanner do the same. Manual code
entry retains an explicit submit action for accessibility and recovery.

The viewer information architecture follows the PWA rather than inventing
Android-only destinations: Activity is on-device motion metadata, while recent
security and camera-access events live in Settings. Access history is normalized
at the API boundary so nullable audit fields never surface as protocol text, uses
local human-readable timestamps, and paginates five events at a time. The native
live viewer uses the same dark, full-viewport hierarchy as the PWA and keeps
audio, source switch, fullscreen, favorite, and adjacent-camera controls in a
bottom control dock.

## Consequences

The Android and web experiences communicate state consistently while retaining
platform-appropriate controls and lifecycle behavior. Visual changes can be made
without weakening capture visibility or privacy shutdown. The small design layer
also makes future phone and tablet layouts easier to evolve, but device-specific
visual acceptance is still required before release.
