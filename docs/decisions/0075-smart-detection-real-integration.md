# ADR 0075: Smart-detection real integration (default-off, on-device only)

Date: 2026-09-26

## Status

Accepted. Supersedes ADR 0074's "not yet integrated" status now that a physical
device (Pixel 7a `34171JEHN07672`) is available in the development session. The
owner explicitly approved proceeding past foundation status and selected the
category scope below.

## Decision

Add `com.google.mediapipe:tasks-vision` and wire a real `ObjectDetector` behind
a new `SMART_DETECTION_ENABLED` `BuildConfig` boolean, default `false` in both
build types, overridable the same way `BEACON_API_URL` already is (Gradle
property or environment variable), so it can be turned on for a controlled test
build without touching production defaults.

**Category scope.** The owner chose "person plus a few relevant categories"
over person-only or the full COCO vocabulary. Detection is restricted, via
`ObjectDetectorOptions.setCategoryAllowlist`, to exactly:

`person`, `car`, `bicycle`, `dog`, `cat`

This is a deliberately short, security-camera-relevant subset of
EfficientDet-Lite0's COCO categories -- not every category the model can name.
Extending this list is a product decision, not a model-capability question;
change it here and record why, not by removing the allowlist.

**Model provisioning.** ADR 0074 flagged this as unresolved and preferred a
build-time download over committing the ~4.4 MiB binary. A new Gradle task,
`downloadSmartDetectionModel`, fetches
`efficientdet_lite0.tflite` from the same official MediaPipe model-store URL
recorded in ADR 0074, verifies its SHA-256 against the value recorded there,
and writes it into a generated (gitignored) assets directory. The task is a
dependency of `preBuild` only when `SMART_DETECTION_ENABLED` is true, so a
normal build never touches the network for this. A checksum mismatch fails the
build rather than silently shipping a different file.

**Wiring.** `CameraXVideoCapturer`'s existing analysis callback
(`publish(image, framerate)`) gains one additional, independent call next to
the existing `motionDetector.analyze(...)` call: when the flag is on, a
`MediaPipeActivityDetector` (implementing ADR 0073's `ActivityDetector`
interface) runs at the same reduced sampling rate as the motion detector
(no more than roughly once per second), converting the CameraX frame to a
`Bitmap` via `ImageProxy.toBitmap()` (available since camera-core 1.3, already
on 1.4.2 here) and wrapping it for MediaPipe via `BitmapImageBuilder`. A
detection result is logged locally; it is **not** sent to the backend, has no
UI surface, and does not affect `MotionDetector`'s own existing report path.
This keeps the experiment observable on-device (via logcat) without adding any
new network call, database column, or user-visible behavior yet.

## What this still does not do

- No backend/database change. A detection result reaching the server, being
  stored, or reaching a viewer needs its own reviewed migration and ADR per
  ADR 0073's requirement 6 -- this change only proves the on-device pipeline.
- No user-facing toggle. The flag is a build-time switch for controlled
  testing, not a setting a household member can reach.
- No thermal/battery/false-positive study yet (roadmap N9). This change makes
  that study possible on real hardware; it does not substitute for it.
- Never facial recognition or a biometric template (ADR 0031, unchanged).

## Validation

New Android unit tests cover the category allowlist and the detector's
plumbing where they don't require a loaded model. `testDebugUnitTest`,
`lintDebug`, `assembleDebug`, and `assembleRelease` all pass with the flag at
its default (off), which never downloads the model or touches MediaPipe.

Real-device verification on Pixel 7a `34171JEHN07672` with the flag
temporarily enabled (2026-09-26): the model downloaded, checksum-verified, and
loaded successfully; the detector ran real inference roughly once per second
with zero crashes across a multi-minute session, correctly returning no
detections while the camera faced an empty wall/ceiling. With the owner
standing in frame, it reported real, sustained `person` detections for about
19 consecutive seconds at confidence 0.55-0.89. Preliminary-only performance
signal from the same session: `top` showed the process using roughly 1.5 CPU
cores and `dumpsys battery` reported 43.6C -- not alarming, but a single
snapshot, not the dedicated thermal/battery/false-positive study roadmap N9
still requires before this is release-ready. The Pixel was returned to the
flag-off, production-matching build afterward; the experiment is not left
running on it.
