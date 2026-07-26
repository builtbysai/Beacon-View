# Product experience

## Information architecture

Beacon presents a household as the top-level context. The current consumer
navigation contains Home, Cameras, Devices, Add camera, and Settings. A device
is a registered endpoint; a camera is a source owned by that device. This
relationship remains visible in cards, device detail, and Live View.

Activity and People are reserved for later milestones because the current
backend does not support them. Diagnostics is an advanced action from device
detail rather than a primary destination. Future modules may add routes and
dashboard sections without changing the device/source hierarchy.

## Design principles

- Calm status language explains whether Beacon is retrying or needs action.
- Live media is teal rather than red; red is reserved for destructive or
  critical states.
- Consumer pages show meaningful capability labels, never raw protocol state.
- Every action has a text label and a minimum 44-pixel target.
- Layouts work without hover and collapse to bottom navigation on small screens.
- Light and dark palettes follow the operating-system preference.
- Motion respects the operating-system reduced-motion preference.

## Data boundaries

The dashboard uses registration, presence, streaming, and viewer-count data
already returned by the backend. Beacon does not display fabricated rooms,
events, battery values, recordings, alerts, or AI results. Android reports
battery and background restrictions locally; these remain device-side
operational guidance until a reviewed backend health contract exists.

## Extension points

Future functional modules should attach to the household shell:

- Activity: event metadata and recording history when storage and retention
  policies exist.
- People: household membership, roles, invitations, and access history.
- Rooms: an optional grouping attribute for devices and sources.
- Automations and detection: separate modules with explicit privacy controls.
- Multi-camera layouts: a viewer mode built after source handoff and concurrent
  streaming behavior have production evidence.

Browser Camera Mode remains an attended, temporary producer. Android remains
the preferred unattended camera because its foreground service and persistent
capture notification provide stronger lifecycle and privacy guarantees.

## Manual acceptance checklist

Do not mark an item complete without performing it on the named environment.

### Desktop web

- Sign in and register; verify errors and keyboard focus.
- Review Home with zero, one, and multiple devices.
- Pair Android, cancel pairing, and observe realtime pairing completion.
- Open Devices, device detail, Cameras, and Live View deep links.
- Rename, disable/enable, revoke, and delete with success and failure responses.
- Switch sibling sources and verify the bounded switching state.
- Deny and grant browser camera permission; start, background, switch, and stop.
- Open diagnostics only from device detail.

### Mobile web

- Use bottom navigation and every 44-pixel control at 320 CSS pixels.
- Verify cards, dialogs, and Live View have no horizontal overflow.
- Test Live View in portrait, landscape, and full screen.
- Switch sources and restore focus after leaving dialogs.

### Android

- Pair and re-pair; deny and grant camera/notification permissions.
- Verify idle, live, reconnecting, offline, and authentication-required states.
- Verify screen-off streaming and the persistent capture notification.
- Verify battery-optimization guidance and source switching.
- Confirm stopping Camera Mode immediately stops capture.

### Accessibility

- Complete primary flows with keyboard only and a screen reader.
- Verify focus visibility/restoration, status labels without color, 200% zoom,
  dark mode, and reduced motion.
