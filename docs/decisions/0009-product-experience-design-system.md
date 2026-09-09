# ADR 0009: Product experience and design system

## Status

Accepted for Milestone 8.

## Context

The existing interface exposed the correct device/camera-source architecture but
presented it as a developer console. It used page-specific dark colors, placed
diagnostics in primary navigation, showed raw capability objects, and lacked a
coherent mobile shell and Live View state stage.

## Decision

Keep the existing React, CSS, and Jetpack Compose stacks and add no UI
dependency. Define semantic CSS tokens for color, surfaces, text, borders,
status, spacing, radius, elevation, focus, and motion. Follow system light/dark
and reduced-motion preferences.

Use household > device > camera source as the durable product hierarchy.
Primary web navigation is Home, Cameras, Devices, Add camera, and Settings.
Diagnostics remains implemented but moves to explicit advanced access from
device detail. Unsupported Activity, People, rooms, recording, and AI modules
remain documented extension points and do not appear as inactive controls.

Live View remains single-camera and preserves sibling-source and parent-device
context. Browser Camera Mode is labeled as attended and less reliable than the
Android foreground-service experience.

## Consequences

The visual system can grow without another styling dependency and remains
efficient on older devices. Native prompt/confirm management interactions remain
technical debt; replacing them with focus-managed reusable dialogs requires
careful mutation-state coverage and should not change backend semantics.
