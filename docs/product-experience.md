# Product experience

## Information architecture

Beacon presents a household as the top-level context. The current consumer
navigation contains Home, Monitor, Cameras, Activity, and Settings. Add camera is
a prominent page action; device management is available through Settings and camera
details. A device
is a registered endpoint; a camera is a source owned by that device. This
relationship remains visible in cards, device detail, and Live View.

Activity displays on-device motion metadata; People remains deferred. Diagnostics is an advanced action from device
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
- Home uses a compact availability summary and consistent camera cards. Privacy and
  access restrictions take precedence over stale online/live flags. Card surfaces
  are status illustrations, not saved photos or automatic background streams.
- Web fullscreen includes the live controls, camera identity, and privacy action.
  Exiting restores focus to the fullscreen button. Listen failures restore muted
  playback; source-switch failures retain the selected camera and explain recovery.
  Connection statistics are secondary details and recognize either local or remote
  relay candidates without treating missing statistics as proof of a direct path.
- Navigation exposes the current page, moves keyboard focus to the new page heading,
  and offers a skip link. Palette tests cover normal-text contrast in light and dark
  mode. Research and remaining acceptance are recorded in `consumer-experience-research.md`.

## Data boundaries

Android keeps capture paused when a local privacy request cannot reach the server.
An unconfirmed pause survives service restart and shows that household synchronization
is pending. Privacy controls remain available without microphone permission. A late
motion report during privacy does not discard a valid device pairing.

Activity filters by camera and time on the server and loads older matching events
in pages. Local-day headings, camera actions, readable empty states, and retry
controls help people find their way through history. New events offer a refresh
without moving the reader; clearing history elsewhere invalidates the open list.
Detection strength is secondary detail and does not imply person identification.
Each Android source offers a clear motion on/off switch, three scene-change sensitivity
choices, and a selected interval between events. The phone receives changes on its next
connection check; the UI says so rather than implying an immediate device update. These
controls affect metadata only, and privacy mode remains the control that stops camera
and microphone capture.
Filters still work when browser storage is unavailable. Clear history explicitly
deletes all household motion metadata, including events outside the selected filters.

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
- Multi-camera layouts: implemented as local monitoring workspaces; server
  synchronization and production capacity guarantees remain future work.

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
- Edit a device name and remove a device with clear success and failure states;
  advanced disable, restart, diagnostics, and revocation operations are not
  exposed as competing everyday actions.
- Switch sibling sources and verify the bounded switching state.
- Deny and grant browser camera permission; start, background, switch, and stop.
- Keep diagnostics outside the everyday device workflow.

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
