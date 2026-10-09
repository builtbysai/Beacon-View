# ADR 0094: Home and Away modes

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089)
- Date: 2026-10-08

## Context

A household that is home does not want motion alerts for its own movement,
and may not want the cameras capturing at all. Today that means muting
alerts per camera and pausing cameras one by one, then undoing it all. The
roadmap row C13 asked for one household-level switch, manual and scheduled,
with no location tracking.

## Decision

- **Two modes.** A household is **Home** or **Away**. Away is the everyday
  watching state and the default. A household with no saved choice is Away
  with the default settings.
- **Who can change it.** Owners and admins. Every member can read the mode.
  Every change is audited (`household_mode_changed`,
  `household_mode_settings_changed`), including who or what made it: a
  person, or the schedule.
- **What Home does** (each is a household setting):
  - **Mute motion alerts** (on by default). Motion events are still recorded
    in the history; only the push, web, and desktop alerts are skipped.
    Offline, recovered, camera-problem, and security alerts are unaffected.
  - **Pause Android cameras** (off by default). It uses the existing privacy
    mode and its existing command path, so the camera stops capturing at
    once and open live sessions end. Nothing new runs on the camera. Cameras
    already paused by a person are left alone.
  - **Resume those cameras when Away** (off by default, and only offered
    when pausing is on). Away starts again only the cameras Home itself
    paused, tracked by `cameras.paused_by_mode`. A person changing a
    camera's privacy mode clears that mark, so Home never resumes a pause
    someone chose. If the household has not opted in, Away forgets which
    cameras Home paused, so a later opt-in cannot resume them retroactively.
- **Schedule.** One to eight windows, each with days, a start and end time,
  and an IANA time zone. Inside any window the household is Home; outside
  all of them it is Away. A window that ends before it starts runs overnight
  and belongs to the day it starts on. A one-minute job moves the household
  when the schedule changes its mind. It remembers what the schedule last
  asked for (`household_modes.schedule_mode`), so a manual change stands
  until the schedule next changes. Saving a schedule applies it at once.
- **No presence detection.** Beacon does not read phone location, Wi-Fi, or
  device presence. The only inputs are a person and a schedule.
- **Privacy rule.** Resuming capture automatically is the one step that
  starts a camera without someone pressing a button on it. It is off unless
  an owner or admin turns it on, it only resumes cameras Home paused, and the
  camera's own capture indicator and notification stay visible as always.
  Home mode itself only ever stops capture.

## Data

`household_modes` (one row per household, created on first change):
mode, source, schedule mode, settings JSON (validated on read and write),
changed at and by. `cameras.paused_by_mode` marks Home's pauses. Migration 0036.

## API

- `GET /api/household/mode`: any signed-in member; includes `canChange`.
- `PUT /api/household/mode`: owner or admin, with CSRF.
- `PUT /api/household/mode-settings`: owner or admin, with CSRF.
- A `household-mode-changed` household event refreshes open viewers.

## Consequences

- A change is one transaction that locks the household's row, so a manual
  change and a scheduled one cannot interleave.
- An offline Android camera picks up its privacy state the way it does for a
  manual pause today.
- Per-camera or per-person modes, vacation dates, and geofencing are
  deferred. Geofencing needs location data Beacon does not collect.
