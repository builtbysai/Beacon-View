# ADR 0092: Motion zones (ignore areas)

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089)
- Date: 2026-10-08

## Context

Motion alerts on a camera pointing at a street, a window, or a ceiling fan
are noise. The roadmap listed "activity zones / calibration" as deferred,
with the requirement to apply it on the device to the existing luma detector
with no frame uploads. This ADR approves that bounded form: **areas to
ignore**, never areas to recognize.

## Decision

- **Model.** A 16 x 16 grid over the picture as viewers see it, numbered row
  by row (0 is the top-left cell, 255 the bottom-right). A camera stores the
  set of ignored cell numbers: `camera_sources.motion_ignored_zones`
  (`jsonb`, an array, migration 0034). **No image is ever stored or sent.**
  A grid, not freehand shapes, keeps the data coarse and tiny.
- **API.** `ignoredZones` is an optional field of the existing motion
  settings (`PUT /api/cameras/:id/motion-settings`). It is validated as
  unique integers 0 to 255, stored sorted. A save that omits it **keeps the
  current zones**, so older clients can't wipe them by accident. Reads
  (viewer and device) always return it.
- **Detector.** The Android detector already samples a 16 x 12 grid of luma
  values. Samples that fall in an ignored cell are skipped, and the changed
  fraction is computed over the samples that count, so ignoring a noisy
  area makes the rest of the picture proportionally more sensitive instead
  of dulling it. Camera frames are not necessarily upright, so each sample
  is mapped through the frame's `rotationDegrees` before the lookup (the
  same mapping the viewer's picture has). If every cell is ignored, the
  camera reports nothing.
- **Editing.** Household owners and admins see an **Ignore areas** button
  on an Android camera's live view. The grid is drawn over the live picture
  (aligned to the picture, not the letterbox bars): touch or drag to paint,
  drag over painted cells to erase, Save, Cancel, Clear all. The viewer
  reads the camera's current motion settings first and sends them back with
  only the zones changed.
- **Scope.** Only Android cameras detect motion (ADR on motion detection),
  so browser and desktop cameras have no zones.

## Privacy and security

- Zones remove detection; they add no capture, upload, or analysis.
- The data is a list of at most 256 small numbers per camera.
- Only owners and admins can change them (the existing per-camera motion
  settings authorization); every change is audited as
  `motion_settings_changed`.
- Nothing about zones changes capture indicators or privacy mode.

## Consequences

- A person who walks only through an ignored area will not trigger an
  alert. The editor says plainly that movement there is ignored, and the
  count of ignored areas is always visible.
- Zones are per camera source. Flipping to another lens of the same device
  uses that lens's own zones.
