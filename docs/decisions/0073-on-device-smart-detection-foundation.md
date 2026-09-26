# ADR 0073: On-device smart detection foundation (experimental)

Date: 2026-09-26

## Status

Foundation only. Not enabled, not evaluated, not release-ready. Nothing in this decision
authorizes a user-facing toggle, a new dependency, or a schema/wire-protocol change.

## Context

`docs/product-build-brief.md` (Milestone 6) and `docs/roadmap.md`'s "Later / deferred" table
both require person/object detection to exist only as a separate, feature-flagged, on-device
experiment, measured for false positives, CPU, thermal, and battery impact before any
user-facing exposure. ADR 0031 additionally requires that person detection send no raw frame
to an AI service and never implement facial recognition or a biometric template. The owner
approved beginning this experiment on 2026-09-26.

The existing on-device motion pipeline (`MotionDetector`, `ConfiguredMotionDetector`, ADR
0014, ADR 0021) is already physically validated on the Pixel (`docs/testing-plan.md`, Sept 25
entries). This decision must not put that proven behavior at risk.

## Decision

Add a standalone `ActivityDetector` interface and `DetectionResult` (category, confidence,
optional coarse region) contract in a new file,
`apps/android-camera/app/src/main/java/com/beaconsecureview/camera/ActivityDetector.kt`,
decoupled from `MotionDetector`/`ConfiguredMotionDetector`.

Ship one implementation, `RegionActivityDetector`: it samples the same fixed luma grid
`MotionDetector` already reads and reports which quadrant concentrates the most change. This
is explicitly **not a trained classifier** and must never be described to users, in code
comments, or in product copy as person or object detection. Its purpose is to validate the
detector/pipeline shape and give a placeholder signal for future thermal/battery
instrumentation, not to detect anything in particular.

Add `SustainedSignalFilter`, a reusable confirmation window that only reports a signal after
N consecutive qualifying samples, intended to reduce single-frame lighting-flicker false
positives in a future detector. It is **not** wired into the production `MotionDetector` in
this change. Adopting it there is a separate, explicitly evaluated decision, because it would
change already physically-validated detection latency and needs its own device evidence.

Neither addition is called from any production code path (`CameraXVideoCapturer`,
`CameraForegroundService`) in this change. No new Android permission, dependency,
`BuildConfig` flag, network call, or backend/database change is introduced. No frame,
thumbnail, or pixel sample is retained or transmitted by either addition, matching ADR 0014's
existing data-minimization guarantee.

## Requirements before this leaves foundation status

1. Select and record, in a new ADR, a real on-device model runtime and model file --
   TensorFlow Lite, MediaPipe, or ONNX Runtime Mobile per the product brief -- including model
   provenance, license, and a size/latency budget for the oldest supported device. Adding that
   dependency needs its own ADR per the working rules ("explain important dependency choices
   in an architecture decision record").
2. Add an explicit, default-off feature flag before wiring any detector into the capture
   pipeline, and disable it automatically on unsupported or overheated devices.
3. Measure false positives, CPU, thermal, and battery impact on at least one older supported
   device (roadmap N9) before considering any user-facing exposure.
4. Never add facial recognition or a biometric template. ADR 0031's boundary is a hard
   boundary and is not revisable by this ADR.
5. Never upload a raw frame to an AI service; category and confidence metadata only, matching
   the existing motion-event contract's data minimization.
6. Any wire-protocol or database schema change to carry a new detection category needs its
   own reviewed migration and ADR, not an implicit addition riding on this one.

## Consequences

This creates a reviewable place to keep building the experiment without risking the currently
physically-validated motion/privacy pipeline. It is not evidence of detection accuracy,
thermal safety, or release readiness, and it does not move "smart detection" out of the
roadmap's deferred table on its own.

## Validation

New Android unit tests (`ActivityDetectorTest.kt`) cover quadrant-concentration selection,
confidence bounds and noise rejection, and the sustained-signal filter's confirm/suppress/reset
behavior and constructor validation. `testDebugUnitTest`, `lintDebug`, and `assembleDebug` pass
with no change to any existing test's outcome.
