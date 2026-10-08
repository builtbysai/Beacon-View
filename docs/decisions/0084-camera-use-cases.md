# ADR 0084: Camera use cases as presets over existing settings

- Status: Accepted (owner-approved October 7, 2026)
- Date: 2026-10-07

## Context

`docs/camera-use-case-profiles.md` (September 26) researched doorbell, baby
monitor, and car profiles and recommended Phase 1: named presets over
settings Beacon already has. The owner asked to think through baby, door,
and security cameras and implement them.

The constraints from that research still hold:

- no continuous or hidden recording
- no voice or content analysis
- no settings the product does not support

## Decision

- `camera_sources.use_case` is `general`, `security`, `baby`, or `doorbell`
  (migration 0032, default `general`). Camera lists return it.
- `PUT /api/cameras/:cameraId/use-case` (owner/admin) sets it. For Android
  cameras, the only ones that detect motion on the device, it applies a
  motion preset in the same statement and leaves quiet hours as the owner set
  them:

  | Use case        | Motion alerts | Clips     | Sensitivity | Cooldown  |
  | --------------- | ------------- | --------- | ----------- | --------- |
  | Security camera | On            | On        | Medium      | 60 s      |
  | Door camera     | On            | On        | High        | 30 s      |
  | Baby monitor    | Off           | Off       | Low         | 300 s     |
  | General         | unchanged     | unchanged | unchanged   | unchanged |

- Browser and desktop cameras are labelled. Their use case chooses Camera
  Mode defaults at setup:
  - Security: standby, no sound
  - Baby monitor: on, with sound
  - Door camera: standby, with sound
  - General: on, no sound
- The UI describes each use case honestly per platform and never promises
  motion alerts for a computer.
- A baby monitor's live view opens with sound. If the browser's autoplay
  policy refuses, it stays muted and the person taps Listen.
- The camera settings sheet offers "What it's for"; tiles show the label.
  Setting up a computer chooses the use case up front and applies it on
  pairing.

## Not included

- A doorbell button and car or impact detection (Phase 2 of the research).
- Cry detection.
- Any continuous recording.

Each needs its own decision.

## Consequences

Use cases ship real value without new capture code, and every setting they
touch already exists. A browser or desktop camera's standby and sound are
still controlled on that computer: changing its use case later in Settings
relabels it and says where to change Camera Mode.
