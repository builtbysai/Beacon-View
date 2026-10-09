# ADR 0096: Split `MonitorHome` into per-page composables

- Status: Accepted (part of the October 8, 2026 convenience batch, ADR 0089, item C17)
- Date: 2026-10-08

## Context

`MonitorHome` in `MonitorUi.kt` was one composable of about 1,350 lines: all
the remembered state, the refresh and session effects, the layout, and the
bodies of the Home, Cameras, Activity and Settings pages. Kotlin's data-flow
analysis of a function that size needed more than 2 GB, which is why the
Android build carried a 4 GB Gradle heap and CI ran lint and the release
build in separate invocations.

## Decision

- Each page is its own composable in its own file: `MonitorHomePage`,
  `MonitorCamerasPage`, `MonitorEventsPage`, `MonitorSettingsPage`.
- `MonitorHome` keeps what must live in one place: the remembered state, the
  effects (refresh, session, launch targets, shortcuts), and the layout
  around the pages. It dropped from about 1,350 to about 450 lines.
- `MonitorHomeState` wraps the existing state objects and the few stores and
  callbacks the pages use, under the property names the page bodies already
  used. The state objects themselves were not moved: ownership, keys, and
  saveable behavior are exactly as before, so this is a pure move with no
  change in behavior. Pages receive the holder and the signed-in session.
- The Gradle heap drops from 4 GB to 3 GB (Kotlin daemon 3 GB), verified
  with `lintDebug` and `assembleRelease`, each run on its own. 2 GB is still
  not enough: the remaining large functions and the page bodies are each
  big. CI keeps its two separate invocations.

## Consequences

- A page can be read, changed and reviewed on its own. New pages follow the
  same shape.
- The holder has about 70 members. Moving state ownership into a view model
  (and out of composition) is the natural next step; it changes behavior
  (process death, user switching) and needs its own tests, so it was left
  out of a behavior-preserving split.
- Verified by compiling, lint, the unit tests, and visiting every page on an
  emulator.
