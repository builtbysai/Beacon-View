# ADR 0047: Visible Android background controls

- Status: Accepted
- Date: 2026-09-12

## Context

Beacon's Android camera is intended to remain available when its Activity is
not foregrounded. Android and device-vendor power policies can still stop or
throttle long-running camera work. At the same time, Beacon must never make
capture hidden or provide a background path that bypasses Android's
while-in-use permission rules.

## Decision

The camera remains owned by the existing camera-and-microphone foreground
service and its ongoing private notification. While capture is active, that
notification exposes a **Pause camera** action that immediately enters the
existing privacy mode and releases capture. Beacon reports battery-optimization
restriction in Camera Home and links to Android's battery-optimization settings;
it does not request or silently obtain an exemption.

There is deliberately no notification action that resumes capture. Resuming
can require a foreground Activity under Android's while-in-use permission
rules, and the device user must be able to see that transition.

## Consequences

- A device user can stop capture without reopening Beacon.
- The app accurately warns when Android may interrupt unattended operation.
- Vendor power management, thermal pressure, revoked permissions, and a forced
  stop can still interrupt the camera; Beacon does not promise otherwise.
- Android remains the unattended producer. Browser Camera Mode remains an
  attended feature because background tabs can be suspended.

## Evidence

On Pixel 7a `34171JEHN07672`, the production-targeted debug build remained a
camera/microphone foreground service after the Activity was backgrounded. Its
ongoing notification exposed one action, and a real Chrome viewer connected
through TURN while the phone stayed backgrounded. The viewer count reached one
and returned to zero after navigation. Android unit tests and the debug build
passed before installation.
