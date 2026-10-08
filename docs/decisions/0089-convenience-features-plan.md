# ADR 0089: Convenience features batch (plan)

- Status: Accepted (owner-approved October 8, 2026: "Plan, build and implement
  them all")
- Date: 2026-10-08

## Context

After picture-in-picture (ADR 0088) the owner approved a batch of
convenience features. The product rules still apply (`AGENTS.md`, the
roadmap's hard boundaries): capture stays visible to the camera-device user,
privacy mode stops capture immediately, nothing is hidden, and there is no
facial recognition, subscription, or new client platform.

## Decision: scope, by track

Each item has a stable ID (`C1` to `C21`). The roadmap table is the status
authority; this ADR records the decisions behind the plan.

### Track A: Viewing

| ID  | Feature                                 | Platforms                |
| --- | --------------------------------------- | ------------------------ |
| C1  | Camera wall (live grid, tap to focus)   | Web, desktop             |
| C2  | Keyboard shortcuts and help overlay     | Web, desktop             |
| C3  | Zoom and pan on live video              | Web, desktop, Android    |
| C4  | Snapshot (saved on the device only)     | Web, desktop, Android    |
| C5  | Hold-to-talk                            | Web, desktop, Android    |
| C6  | Mini-player that follows you in the app | Web, desktop             |
| C7  | Announce on all cameras                 | Web, desktop             |
| C8  | Cast to a TV                            | **Deferred** (see below) |

### Track B: Shortcuts and entry points

| ID  | Feature                                           | Platforms             |
| --- | ------------------------------------------------- | --------------------- |
| C9  | PWA app shortcuts                                 | Web (installed)       |
| C10 | Android launcher shortcuts (static and favorites) | Android               |
| C11 | Desktop tray: favorite cameras and the wall       | Desktop               |
| C12 | Alerts open the exact camera or clip              | Web, desktop, Android |

### Track C: Safety and automation

| ID  | Feature                                        | Platforms                          |
| --- | ---------------------------------------------- | ---------------------------------- |
| C13 | Home / Away modes (manual and scheduled)       | Server, web, Android               |
| C14 | Camera health alerts: low battery, overheating | Server, web, Android               |
| C15 | Motion zones (ignore areas)                    | Server, web, Android               |
| C16 | Data saver (lower quality on request)          | Web viewer, browser/desktop camera |

### Track D: Engineering

| ID  | Work                                                                 |
| --- | -------------------------------------------------------------------- |
| C17 | Split `MonitorHome` into per-page composables; lower the Gradle heap |
| C18 | Update CI actions off the deprecated Node 20 runtimes                |

### Boundary decisions

- **Cast to a TV (C8) is deferred.** The browser Remote Playback API cannot
  send a live `MediaStream` (WebRTC) to a Chromecast, and Chromecast or
  AirPlay-as-a-sender would need a Cast receiver app. That is a new client
  surface, which the roadmap excludes beyond the ADR 0082 desktop app. It
  needs its own design decision.
- **Home / Away is schedule and manual only.** Presence by phone location
  (geofencing) would collect a new, sensitive data class (where people are)
  and needs its own threat model and consent, so it is deferred.
- **Auto-resume is opt-in.** A schedule or the Away mode can pause cameras
  with no extra consent, since pausing only protects privacy. Resuming
  capture automatically needs the owner's explicit opt-in per mode.
  Capture indicators on the device (notification, tray, power lock) stay
  exactly as they are when a camera resumes, so nothing becomes hidden.
- **Camera wall is web and desktop only.** The roadmap excludes
  simultaneous native multi-camera playback, so Android keeps its single
  live view (plus the existing favorites cards).
- **Snapshots never leave the device.** A snapshot is a local file the
  person saves; Beacon uploads nothing, and nothing is stored on the server.
  Motion zones likewise store only a coarse 16 × 12 on/off grid, never an
  image.
- **Announce talks through each camera with its normal rules.** Per-camera
  Talk grants still apply, each camera still shows its talking notice, and
  cameras without a grant are skipped.

### Assumptions

- The Android motion detector's existing 16 × 12 luma grid is the zone
  resolution.
- Heartbeats already carry battery; thermal state is a new optional field
  (Android `PowerManager` thermal status, API 29+).
- Notification categories gain `health`; per-camera preferences cover it.

## Milestones

1. **M1:** roadmap, this ADR, CI action updates (C18).
2. **M2, web viewing pack:** C2, C3, C4, C5, C9, C12.
3. **M3, multi-camera web:** C1, C6, C7, C16.
4. **M4, safety:** C13, C14, C15 (server, web, Android detector).
5. **M5, Android and desktop entry points:** C3/C4/C5 on Android, C10, C11,
   C12 on Android.
6. **M6, engineering:** C17.

Each milestone is its own pull request with its own validation (tests,
browser run, emulator run where Android is involved).

## Consequences

- Two new data fields (motion-zone grid, thermal state) and one new table
  family (home/away modes) arrive with migrations and are covered by
  `migrate-verify`.
- The threat model gains notes for snapshots, zones, and automation.
