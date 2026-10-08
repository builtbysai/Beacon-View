# ADR 0074: Smart-detection runtime and model selection (not yet integrated)

Date: 2026-09-26

## Status

Selection only. The dependency is **not added** and the model file is **not committed** to
this repository by this decision. This satisfies ADR 0073's first requirement ("select and
record, in a new ADR, a real on-device model runtime and model file... including model
provenance, license, and a size/latency budget") without taking on an unvalidated binary
dependency or a code path this environment cannot test.

## Context

ADR 0073 built a decoupled `ActivityDetector` interface and an explicitly-not-a-classifier
heuristic placeholder, and listed a real runtime/model choice as the next requirement before
the smart-detection experiment can leave foundation status. The product brief names three
candidate runtimes: TensorFlow Lite, MediaPipe, or ONNX Runtime Mobile.

This session has no attached Android emulator or physical device (the Pixel
`34171JEHN07672` is not connected to this environment). Android's `testDebugUnitTest` task
runs on the host JVM; prebuilt Android ML runtime AARs ship only Android-triple native
libraries (`arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` as `.so` files built for Android's
bionic libc), which a Windows/host JVM unit test cannot load. Real inference can only be
exercised in an instrumented `androidTest` on an emulator or device. Adding the dependency
and model file now, before that hardware is available, would mean shipping a bundled binary
and an unverified code path with no way to confirm it loads or runs correctly here.

## Decision

Select **MediaPipe Tasks Vision's `ObjectDetector`** (`com.google.mediapipe:tasks-vision`)
over raw TensorFlow Lite or ONNX Runtime Mobile, for this project specifically:

- It is Google's current recommended path for on-device object detection on Android (raw
  TFLite is now the lower-level engine MediaPipe Tasks itself sits on), actively maintained,
  with a stable, documented Kotlin/Java API (`ObjectDetector.createFromOptions`,
  `detect(MPImage)`), which matches "prefer mature, well-maintained dependencies."
- ONNX Runtime Mobile is also mature but has a smaller Android-specific vision-task
  ecosystem and no equivalent first-party pre-converted, benchmarked mobile detector comparable
  to MediaPipe's own model zoo; choosing it would mean sourcing and converting a model
  ourselves, which is unnecessary extra surface for a foundation-status experiment.

Select **EfficientDet-Lite0 (int8-quantized)** as the candidate model, downloaded and
verified from Google's official MediaPipe model store for provenance:

| Property              | Value                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source URL            | `https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite`                                                                                                                                                            |
| File size             | 4,602,795 bytes (4.39 MiB), verified 2026-09-26                                                                                                                                                                                                                                  |
| SHA-256               | `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`                                                                                                                                                                                                               |
| License               | Apache License 2.0 (MediaPipe model zoo)                                                                                                                                                                                                                                         |
| Vendor-quoted latency | Google's published MediaPipe benchmark for this exact model is on the order of tens of milliseconds per frame on a mid-range Pixel-class CPU; this is a vendor figure, not a Beacon-measured one, and must not be treated as a validated budget for the oldest supported device. |

This model was downloaded to a local scratch location only, to record its real size and
hash for this ADR; it was not added to the repository.

## What this ADR does not do

- Does not add `com.google.mediapipe:tasks-vision` (or any ML runtime) to
  `apps/android-camera/app/build.gradle.kts`.
- Does not commit `efficientdet_lite0.tflite` or any other model file to the repository. A
  ~4.4 MiB binary checked into git history is a permanent, non-diffable cost paid by every
  future clone; it should not be paid before the model is confirmed useful. If this
  proceeds, prefer a Gradle task that downloads and checksum-verifies the model at build
  time (mirroring how `google-services.json` is handled as an ignored, installed file)
  over committing the binary, unless offline/reproducible builds require otherwise.
- Does not implement a `MediaPipeActivityDetector` or wire anything into
  `CameraXVideoCapturer`/`CameraForegroundService`.
- Does not add a feature flag yet -- there is nothing to flag until the above exists.

## Requirements still open before integration

1. An Android emulator or the physical Pixel must be available to write and run an
   instrumented `androidTest` -- real MediaPipe/TFLite inference cannot be verified by
   `testDebugUnitTest` on this host, per the Context section above.
2. Decide model provisioning (committed binary vs. build-time download-and-verify) before
   either exists in the tree, so the choice is deliberate rather than default.
3. Measure real latency, CPU, thermal, and battery impact on-device (roadmap N9) rather
   than relying on the vendor-quoted figure above.
4. A default-off feature flag, added at the same time as the first call site, per ADR 0073.
5. The category vocabulary MediaPipe's COCO-trained EfficientDet-Lite0 produces (e.g.
   "person", "car", "dog") must be filtered and re-labeled deliberately before any of it
   reaches a user or the backend -- report only what the product actually wants to surface,
   and never a name, face crop, or biometric template regardless of what the model detects.

## Consequences

The runtime/model choice is now recorded and reviewable, closing ADR 0073's first open
requirement, without adding risk this environment cannot retire. The next concrete step
requires either physical/emulator access in a development session, or an explicit owner
decision to proceed with the dependency and a build-time model-provisioning mechanism before
that access is available.
