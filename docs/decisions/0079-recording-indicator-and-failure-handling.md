# ADR 0079: Persistent recording indicator and intentional failure handling

- Status: Accepted for the active milestone
- Date: 2026-09-27

## Context

The manual "record a short clip" control (live view and browser camera
mode) only ever exposed its state through `data-tooltip`, an attribute
with no accompanying CSS or JS anywhere outside `Sidebar.tsx`'s own
collapsed-rail tooltip -- on every other button that used it (record,
mute, talk, fullscreen, "connect Drive to record"), it rendered nothing.
The only visible state was a subtle button-background change, so nothing
told a sighted user which camera was recording, why, how long it had
run, or that it was a manual (not automatic) recording, and nothing
showed at all on a touch device, which is most of this product's
audience.

Separately, an active recording had no defined behavior if its source
stream stopped being trustworthy mid-capture -- a dropped WebRTC
connection, a revoked camera permission, the OS closing the camera. The
recorder would keep running against a dead stream until the 3-minute
auto-stop, then attempt to upload whatever it had captured.

## Decision

- A new `RecordingBadge` (shared by `LiveVideo` and `BrowserCameraMode`)
  renders persistently next to the existing LIVE/broadcast status pill --
  not on hover. It shows one of: Starting…, Recording · Manual (with a
  running timer), Uploading…, Clip saved, or Recording failed. The
  container is `role="status" aria-live="polite"` so a state _change_ is
  announced once; the ticking timer itself is `aria-hidden` so it isn't
  re-narrated every half second. The recording dot uses a subtle opacity
  pulse, disabled entirely under `prefers-reduced-motion: reduce`.
- Every clip recorded through this control is manual by construction --
  automatic (motion-triggered) recordings never involve this UI at all,
  so the badge always says "Manual" rather than trying to infer it.
- The inert `data-tooltip` attribute on the video/broadcast controls is
  replaced with the browser's native `title`, which actually renders a
  tooltip. This is a plain, zero-dependency fix; it does not attempt to
  extract Sidebar's tooltip positioning logic into a shared component,
  since that logic is specific to a collapsed icon rail and not a good
  fit for a bottom control bar.
- `useClipRecorder` gains `abort(message)`: discards the in-progress
  capture (never uploads it -- a clip finalized from a dead stream would
  just be broken), best-effort reports `capture_failed`, and surfaces
  `message` as a real, visible failure rather than continuing silently.
  It is invoked from two places: `LiveVideo` watches its own connection
  status and aborts if it leaves `connected` while recording; the hook
  itself watches the source stream's video track for an unexpected
  `ended` event (covers a revoked permission or the OS closing the
  camera in `BrowserCameraMode`, and a torn-down remote track in
  `LiveVideo`).
- Failure and cleanup on tab close / navigating away, on storage/upload
  failure (quota, auth expiry, transient Drive errors), and on abandoning
  a finished-but-undiscarded clip were already handled before this
  change and are unchanged.

## Consequences

- No new backend capability was introduced; this is entirely a client-side
  visibility and error-handling improvement built on the existing
  recording lifecycle (`requested/recording/uploading/available/failed`).
- The badge's visual language is currently duplicated with slightly
  different chrome between `LiveVideo` (dark video overlay, sharp
  corners) and `BrowserCameraMode` (pill-shaped broadcast badge) rather
  than pixel-identical -- both read clearly, but a later pass could unify
  the two badge shells if that inconsistency becomes worth fixing.
- Aborting on stream-end relies on the browser actually firing `ended` on
  the track, which is reliable for local `getUserMedia` tracks but not
  guaranteed for every possible remote-track teardown path; the
  connection-status watcher in `LiveVideo` is the more reliable signal
  for that surface and does not depend on the track event at all.
