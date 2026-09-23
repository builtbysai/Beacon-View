# 0056: Contextual Camera Settings sheet

## Status

Accepted for the web and PWA Camera Settings pass.

## Decision

Camera Settings uses the existing device settings route for deep links and browser
history, but opens as a native modal dialog over the current workspace or live
viewer. The Cameras page remains mounted so its search, filter, and scroll state
survive opening and closing the sheet. Opening settings from live view keeps the
viewer mounted. The history entry records the background page and camera so
browser Back and Forward restore the context of an in-app sheet.

The panel uses a right-side sheet on wide screens and a full-width bottom sheet
on narrow screens. The native dialog supplies focus containment and Escape
handling; the shared modal preserves workspace scroll and restores trigger focus.

## Consequences

Direct settings links use the Cameras page as their background. Camera and device
controls continue to use the existing API contracts. The separate compact live
settings dialog is no longer opened by the live viewer.
