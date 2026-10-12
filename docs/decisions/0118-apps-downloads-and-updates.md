# ADR 0118: Where to get Beacon, and one way each kind of install stays up to date

- Status: Accepted (2026-10-12)

## Context

Downloads lived only on the landing page, as seven cards of unequal weight (no version for Android, no way to
check a file, the same layout whether or not the visitor's own device had a build). Signed-in people could not
find them at all. Updates worked for the desktop app (a signed feed, installed when the camera and window are
idle) and by accident for the web (a service worker that took over silently while open pages kept running old
code). A page left open on a wall tablet or camera computer never updated, and neither the web nor the Android
app said what version it was.

## Decision

**Where to get Beacon.** One component, `AppDownloads`, shows the option for this device first and large (what
it does, the version, size, a verifiable SHA-256, the first-launch caveat for unsigned builds) and every other
way as a short list. It is used on the landing page, in Settings under _Apps & updates_, and in the Add a device
flow (the device's own app is offered next to "use this device"). Only builds the server actually publishes get a
button. Inside the app the "any browser" row is dropped, and an installable site offers the browser's own
"install as an app".

**Updates, one rule per kind of install:**

- _Web and installed web app._ The build writes `/version.json` naming its entry script. An open page compares it
  with its own entry script shortly after load, when it comes back into view and every half hour, and shows a
  quiet "A new version is ready, Reload / Later" bar (Later waits four hours). A hidden page with an update
  waiting reloads itself after ten minutes, but only when nothing needs it: a live view, an open camera and a
  clip being recorded or uploaded register themselves as busy. An unattended screen catches up; a camera is
  never cut off. This follows Workbox's guidance to ask before activating a new service worker when a
  reload could interrupt something ([Workbox: handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates)).
- _Desktop app._ Unchanged: a verified, signed feed, installed when the window is hidden and the camera is not
  live. Settings now shows the installed version, a check button, download progress and "Restart to update".
- _Android app._ The app reads the downloads manifest when it opens, and when a newer build is published shows a
  card (and an About row in Settings) that sends the person to the download. Sideloaded installs cannot use the
  Play in-app update API, which requires a Play install
  ([Android in-app updates](https://developer.android.com/guide/playcore/in-app-updates)), so a Play install is
  left to Play. Replacing the app keeps its pairing and sign-in because the package and signing key do not change.

## Standby cameras (found in the same review)

A standby camera opens when a viewer arrives and lets go when the last one leaves. Two faults made it fail
"sometimes": a camera that the system ended by itself (unplugged, taken by another app, the computer slept) was
kept as the open camera and handed to the next viewer as dead video, and a camera another app was releasing for a
moment reported "busy" and the viewer gave up. Camera Mode now notices when a camera ends, lets go of it, and
opens a fresh one for the next viewer; an always-on camera starts again after 1.5, 8 and 30 seconds before it
stops and says why; and a busy camera is tried once more after a short wait.

## Not done

- Android has no silent background update outside Play; the person taps Download and Install.
- The web check needs the server's `version.json`; a page that cannot read it simply never offers an update.
