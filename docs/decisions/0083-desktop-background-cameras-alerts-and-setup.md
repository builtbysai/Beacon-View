# ADR 0083: Desktop standby cameras, alerts, one-click setup, and downloads

- Status: Accepted (owner-approved October 7, 2026)
- Date: 2026-10-07

## Context

ADR 0082 shipped the desktop app. The owner then asked for several things:

- desktop alerts
- start at sign-in
- a camera that runs in the background with the lens off until a viewer
  wakes it
- an easy, pre-configured install that sets a computer up as a camera
- a Google sign-in tab that doesn't strand the person on Google's page
- downloads on the landing page

The deployment is self-hosted, so code signing is not required yet.

## Decision

### Standby (wake on view)

Signaling is already demand-driven. A camera holds an authenticated
WebSocket, and the server sends `viewer-ready` only when someone opens the
live view. Browser Camera Mode therefore gains a camera power choice, with no
backend change:

- **Keep the camera on** is the default and the existing behavior.
- **Standby**: Camera Mode stays connected and shows as ready, but no
  `getUserMedia` stream exists. `BrowserProducer` accepts an on-demand stream
  source, so the first viewer turns the camera on and concurrent viewers
  share one stream. The camera turns off 20 s after the last viewer leaves.
- If the camera can't wake, only that viewer's negotiation ends; the camera
  stays on standby.

An optional microphone choice ("include sound so viewers can listen") was
added at the same time.

### Capture visibility in the background

The desktop tray distinguishes off, standby, and live. While a camera is on
standby or live, the app holds `prevent-app-suspension` so the camera stays
reachable; the display may still sleep. If the camera turns on while the
window is hidden, a notification says so, and quitting a running camera asks
for confirmation. Capture never starts silently.

### Resume and start at sign-in

While Camera Mode runs in the desktop app, the page reports a validated
resume path:

- `/camera-mode` or `/camera-mode/setup`
- `autostart=1` plus power and microphone
- never a pairing code

The app reopens that path at startup. Stopping or leaving Camera Mode clears
it.

Start at sign-in is offered in the tray and in Settings → This computer, off
by default. One-click camera setup turns it on and tells the person.

### Desktop alerts

Notification subscriptions accept a `desktop` channel (migration 0031).

- The provider material is the subscribing session.
- The existing outbox, preferences, and quiet hours decide every alert.
- The sender delivers the same generic payload as Web Push and FCM (category
  and opaque event ID) over that session's authenticated realtime connection
  (`HouseholdEventHub.sendToSession`).
- If the app is offline, retries continue only while the alert is useful
  (about 6 minutes for motion and about 36 otherwise, mirroring push TTLs).
  The alert then expires through `markNotificationExpired`, which never
  revokes the subscription.
- The app shows OS notifications with the PWA's generic copy, removes
  duplicates by event ID, and opens Activity or Settings on click.

### One-click camera setup

A household member uses Add camera → Set up another computer: pick a use
case (ADR 0084), and Beacon creates the normal one-time, 10-minute pairing
code. It is offered three ways:

1. **A pre-configured Windows download.** The `download` attribute names the
   same-origin installer `… beacon-camera-<CODE>-<power>[-mic].exe`. The
   NSIS installer records its own file name in
   `%APPDATA%\Beacon\pending-camera-setup.txt`. On first launch the app reads
   it once, discards it if it is older than 30 minutes, and deletes it.
2. **For an installed app:** a `beaconsecureview://camera/setup` link, or a
   `.beaconcamera` file. The file is associated by the installer, holds only
   the code, and must name this app's own origin.
3. **A plain browser link.**

Every path ends on the web pairing page with `autostart=1`. That page redeems
the code exactly as a manual setup would and removes it from the address bar.

The chosen use case is applied when the realtime `camera-paired` event
arrives.

### Google sign-in tab

Desktop sign-in now lands on `/auth/desktop/complete#code=…`. The code is in
the fragment, so it never reaches server logs. That page opens the app,
removes the code from history, and says the tab can be closed. Browsers only
let script close tabs that script opened, so the page offers a Close button
with a keyboard hint rather than pretending. The app brings its window to the
front, floating it briefly on Windows to get past focus-stealing protection.

### Downloads

Installers are self-hosted at `/downloads/`. The source is a read-only host
folder, `/opt/beacon/downloads`, served by the web container. The manifest is
`no-cache`; installers are cacheable, never recompressed, and support byte
ranges.

`scripts/build-desktop-manifest.mjs` lists only files that exist, and the
landing page's "Get Beacon on every device" section offers only those.

`.github/workflows/desktop-release.yml` builds the Windows, macOS, and Linux
installers on demand.

### Installer follow-ups

- The install folder is `Programs\beacon` (`extraMetadata.name`).
- The NSIS include registers the link scheme per user.

## Consequences

- A computer can be a background camera whose lens is off until viewed,
  which helps privacy and power use. A viewer waits about a second while the
  camera turns on.
- Desktop alerts follow the same server-side rules as every other channel.
  They need the app running and signed in, and they reach household owners
  and admins (the roles that open the realtime connection).
- The pre-configured installer carries a code that is single-use and expires
  in 10 minutes. Anyone holding the file within that window can pair one
  camera to the household, exactly like sharing the code itself.
- Browser and desktop cameras still do not detect motion. Standby therefore
  never misses a motion alert, and use cases never promise one for them.
- macOS and Linux builds are produced by the release workflow. They remain
  unsigned or un-notarized until the owner chooses otherwise.
