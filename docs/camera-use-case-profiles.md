# Camera use-case profiles — research and proposal

Status: research/proposal only. No implementation has started. This exists to
give the owner a concrete decision to make, not to announce a feature.

## Why

The owner is considering purpose-built camera behavior instead of one
undifferentiated "always on" camera: a doorbell-style camera that stays
dormant until triggered, a car/dash camera, and the existing regular camera.

## Research: how existing products do this

**Doorbell cameras (Ring-style).** Two separate alert types, not one: a
button-press alert (always active regardless of arm/disarm mode, since a
visitor pressing a button is unambiguous intent) and a motion alert (movement
in a drawable "motion zone," tunable by sensitivity and zone shape).
Battery-powered units reduce how often they poll for motion to conserve
power; wired units can poll continuously. Modes (Home/Away/Disarmed) change
which alerts are active without changing the hardware.

**Dash/car cameras.** "Parking mode" puts the camera in low-power standby
and wakes it on motion or on a G-sensor (accelerometer)-detected impact.
G-sensor-triggered clips are protected from being overwritten by loop
recording — ordinary loop recording continuously overwrites the *oldest
unprotected* footage once storage fills, but an impact event locks its clip
so a hit-and-run or break-in isn't erased by the next few minutes of normal
driving.

**General pattern across device categories.** Indoor/wired devices default to
continuous availability; outdoor/battery devices default to event-triggered
capture to manage power and (for cellular/battery designs) bandwidth. The
distinguishing design axis isn't really "indoor vs outdoor" — it's power
budget and whether the device can afford to stay fully awake.

## Constraints specific to Beacon (read before proposing scope)

**Hard boundary — no continuous or hidden recording.** Stated explicitly in
[roadmap.md](roadmap.md) ("Hard boundaries: no continuous or hidden
recording...") and [product-build-brief.md](product-build-brief.md) ("No
hidden recording."). A naive "car camera = loop-record the whole drive"
feature is a materially different privacy posture than Beacon's current
motion/manual short-clip model and would conflict with this boundary as
currently understood. **Do not implement continuous/loop recording without
an explicit, separate owner decision** — treat it as its own privacy review,
not a sub-task of "add a car profile."

**Beacon runs on repurposed Android phones, not purpose-built low-power
camera hardware.** This cuts both ways:
- No hardware doorbell button exists. A literal "press a button" doorbell
  alert would require new hardware (e.g. pairing a Bluetooth button) — that's
  a real feature with its own pairing/reliability surface, not a small
  addition. Treat it as a stretch goal, not part of a first cut. A phone
  screen itself could act as a tap-to-alert surface for a mounted device, but
  that's a UX/mounting assumption the owner would need to confirm makes sense
  for the target hardware.
- Every Android phone already has an accelerometer. That *is* a genuine,
  already-present equivalent to a dash-cam's G-sensor — a real, buildable new
  trigger type, distinct from Beacon's existing luma-based motion detection.
- Phones don't have the same battery-conservation profile as purpose-built
  battery doorbell cameras (no deep-sleep radio wake patterns tuned for
  months of standby), so "reduce polling frequency to save battery" is a much
  smaller win here than it is for Ring-style hardware — worth doing, not
  worth over-engineering.

**Current camera/motion schema to build on** (`camera_sources` table):
`motion_enabled`, `motion_record_enabled`, `motion_sensitivity`
(low/medium/high), `motion_cooldown_seconds` (30/60/120/300),
`motion_quiet_hours_start_minute`/`end_minute`/`time_zone`. Surfaced through
[`apps/web-viewer/src/MotionSettingsPanel.tsx`](../apps/web-viewer/src/MotionSettingsPanel.tsx)
and [`apps/backend/src/motion-settings.ts`](../apps/backend/src/motion-settings.ts).
Android currently does luma-based motion detection; the smart-detection
foundation (ADR 0073/0074) already defines an `ActivityDetector`-style
interface as a landing spot for additional detector types without redesigning
the pipeline.

The repo's own settings rule (from this session's owner feedback) applies
directly here: **do not expose settings unsupported by the actual product.**
A profile picker that silently does nothing on the backend, or that exposes a
"button press" toggle with no button, would violate that.

## Proposed profiles

**Regular / Always-on (today, unchanged).** Continuous live-view
availability, motion-triggered and manual short clips as already configured.
This is the default and needs no new work.

**Doorbell.** A named preset over *existing* settings — high
`motion_sensitivity`, short `motion_cooldown_seconds` (e.g. 30s), and
`motion_record_enabled` on by default — plus, if useful, an elevated
notification priority for this camera's motion alerts vs. a regular camera's.
No new capture architecture. Genuinely buildable soon. A literal
button-press alert is explicitly out of scope for this phase (see hardware
constraint above); if the owner wants it later, scope it separately.

**Car / Dashcam.** Two genuinely different pieces, and they should not be
proposed as one feature:
- A preset (motion-triggered short clips, tuned sensitivity/cooldown for a
  parked vehicle) — same low-risk shape as Doorbell, buildable soon.
- A *new* trigger: reading the Android accelerometer as a second, independent
  detector alongside luma motion, so an impact while parked produces a
  protected clip even if the luma detector misses it (e.g. low light, camera
  facing a wall). This needs new Android code but fits the existing
  short-clip model — an impact produces one clip, not a recording session.
- **Explicitly excluded from this proposal**: continuous/loop recording
  while driving. Flagged above as its own privacy decision, not bundled in
  here.

## Proposed incremental plan

1. **Phase 1 — profile presets.** Add a `camera_sources.use_case` (or similar)
   enum column, default `'standard'`. Selecting "Doorbell" or "Car (parked)"
   in the UI just writes the corresponding existing motion-settings values;
   no new capture code, no new detector. Low risk, ships real value
   immediately, and is consistent with "don't expose settings the product
   doesn't support" since every setting it touches already exists and works.
2. **Phase 2 — accelerometer trigger for Car profile.** Add Android
   accelerometer-based impact detection as a second detector source,
   structured behind the existing smart-detection interface (ADR 0073) rather
   than special-cased into the camera service. Produces a short clip on
   impact, using the existing recording pipeline — no new upload/storage
   model needed.
3. **Phase 3 — gated on an explicit owner decision.** Evaluate whether true
   continuous/loop recording for driving is something Beacon wants to support
   at all, given the no-continuous-recording boundary. This needs its own
   privacy/product review before any implementation — do not start it as a
   natural extension of Phase 1/2.

**Recommendation:** start with Phase 1. It's real, low-risk, doesn't touch
the hard boundary, and both the Doorbell and Car presets ship from the same
schema/UI work.

## Open questions for the owner

- Does "car camera" mean parked-vehicle monitoring (fits Phase 1/2 cleanly),
  continuous drive recording (Phase 3, separate privacy decision), or both?
- Is a literal doorbell hardware button in scope at all, or is "motion alert
  with elevated priority" sufficient to call it a doorbell profile?
- Which profile, if any, should be built first — this doc recommends Phase 1
  (both presets) but doesn't assume that decision has been made.
