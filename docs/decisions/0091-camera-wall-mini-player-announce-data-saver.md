# ADR 0091: Camera wall, mini-player, announce, and Data saver

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089)
- Date: 2026-10-08

## Decision

This covers items C1, C6, C7 and C16. All of it is web and desktop (the
desktop app shows the web app). Android keeps its single live view: the
roadmap excludes simultaneous native multi-camera playback.

- **Camera wall (C1).** `/wall` shows every available camera live in one
  grid, and tapping a tile opens that camera full size.
  - At most 9 tiles stream at once; the rest are listed as not shown.
  - Tiles stream only while near the screen (scrolling a long wall starts
    and stops cameras), and use the wall bitrate cap below.
  - Layout is automatic (1, 2 x 2, 3 x 3) or a chosen column count, saved
    on the device. The wall can go full screen.
- **Data saver and tile bitrate (C16).** A viewer asks a camera for less
  video by adding `b=AS:<kbps>` to its SDP answer. Camera encoders honor it
  and lower bitrate and, if needed, resolution. Nothing changes on the
  camera, the server, or the signaling protocol, and it affects only what
  this viewer receives.
  - Settings, Viewing, Data saver: 400 kbps (saved on the device).
  - Wall tiles: 350 kbps always.
  - The lower cap wins when both apply.
  - "Lower quality when nobody is watching" already holds by design:
    signaling is demand-driven, so a camera sends nothing until a viewer
    arrives (ADR 0083).
- **Announce on all cameras (C7).** On the wall, an Announce button (hold to
  talk, tap to toggle, like the Talk button) starts every tile's own talk
  session. Each camera keeps its normal rules: the viewer needs that
  camera's Talk grant, one person talks through a camera at a time, and the
  camera still shows its talking notice. Cameras that can't take it
  (paused, offline, no grant, busy) are skipped and never forced. The button
  shows how many cameras it will reach, and how many are being talked
  through.
- **Mini-player that follows you (C6).** The live player is hosted above the
  pages. When someone leaves the live view while its picture is floating
  (ADR 0088), the player stays mounted but parked off-screen (never
  `display: none`, which would end the floating window), so it keeps playing
  while they use the rest of Beacon.
  - It closes when the floating window is closed, or when a different
    camera is opened.
  - Returning to the same camera docks the picture back with no reconnect.
  - A parked player is `inert` and `aria-hidden`, so keyboards and screen
    readers don't reach it.

## Consequences

- No server or database change.
- A wall of N cameras opens N viewer connections, so the 9-tile cap and the
  bitrate cap keep a household's cameras and phones comfortable.
- The mini-player holds one camera's connection while parked.
