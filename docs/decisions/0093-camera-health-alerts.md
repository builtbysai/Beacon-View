# ADR 0093: Camera health alerts (low battery, overheating)

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089)
- Date: 2026-10-08

## Context

A phone used as a camera fails quietly in two ways before it goes offline: it
runs out of battery, or it overheats and Android throttles or shuts it down.
Beacon already alerts when a camera goes offline and when it returns
(ADR 0044). The roadmap's "rich device health" row asked for actionable
warnings under a minimal telemetry contract.

## Decision

- **Telemetry.** The heartbeat already carries battery percentage and
  charging state. It gains an optional `thermalStatus`, Android's own
  `PowerManager` thermal status: none, light, moderate, severe, critical,
  emergency, shutdown (Android 10 and newer; older phones send nothing).
  Beacon stores only the latest value per device (`cameras.thermal_status`),
  with no history.
- **When an alert is raised** (one per episode):
  - Low battery: 15% or less and not charging. It clears when charging
    starts or the level is 25% or more. Hovering between 16% and 24%
    neither raises nor clears, so a battery sitting at the limit cannot
    alert repeatedly.
  - Overheating: severe or worse. It clears at moderate or cooler, so
    easing from critical to severe is still one episode.
  - A device's health must be under 10 minutes old. A silent camera is the
    offline alert's job, not a stale battery reading's.
- **Who is told.** The same people, preferences, quiet hours, and delivery
  channels as the offline alert: household owners and admins who turned the
  camera's alerts on. That one preference is now labelled **Camera
  problems** and covers offline, back online, low battery, and overheating.
  No new preference or migration of preferences is needed.
- **Quiet hours** silence the alert and still record the episode, so the
  same episode doesn't fire when quiet hours end. The next episode will.
- **Payload.** A new category, `health`, with the same generic shape
  (ADR 0044): version, opaque event ID, category, generic route. The
  notification text is fixed per channel ("A Beacon camera has a battery or
  heat warning.") and names no camera. Opening it uses the alert link from
  ADR 0090, so a tap opens the camera it was about.
- **Detection.** A scan runs with the existing notification job under its own
  advisory lock, reads current device state, and records the open episode in
  `notification_presence_state` (two timestamps added by migration 0035). No
  new worker or table.

## Privacy

- Battery and thermal state describe the phone, not the home or its people.
- Nothing is collected beyond the latest value, and nothing is kept as
  history.

## Consequences

- The database constraint on notification categories gains `health`
  (migration 0035, covered by `migrate-verify`).
- Browser and desktop cameras report no thermal state and so never raise a
  heat alert. They report no battery either today.
