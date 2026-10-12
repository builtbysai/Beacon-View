# ADR 0121: The Android app hosts the web app

- Status: Accepted (2026-10-12). Implementation is staged; the Status line of each stage is at the bottom.

## Context

The owner asked for the Android app to look and behave exactly like the web app, screen for screen and state for state,
with every feature. The Android monitor was rebuilt natively in Jetpack Compose, so every screen exists twice (React and
Compose) and drifts: four review passes in one day found a different set of defects in the Compose copy each time
(invisible menu text, a collapsed settings panel, truncated names, a wrong empty state), and a feature added to the web
needs a second implementation before Android has it.

Three ways to make them identical were considered.

1. **Keep two UIs and chase parity.** What we have. It never converges, and it doubles the cost of every change.
2. **Rewrite the Android UI again, closer to the web.** Still two UIs. Parity is a discipline, not a property.
3. **Run the web app inside the Android app.** One UI. Identical by construction, including every future change.

For option 3 there are two mechanisms.

- **Trusted Web Activity** opens the site in Chrome with a verified link and gives pixel-identical pages, but the app
  cannot reach into the page, share its session, or put native screens in the flow. It needs Chrome and cannot host the
  camera agent's controls inside the product's own screens.
  ([Android docs](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities))
- **A WebView in our own activity** hosts the same pages and lets the app add what a browser cannot do: the camera
  agent, privacy mode, push, pairing, updates. The legacy `addJavascriptInterface` bridge is unsafe because every
  frame can call it and the app cannot verify the caller. The origin-restricted `addWebMessageListener` is the
  supported alternative, and the WebView must grant camera and microphone to the page one resource at a time.
  ([Android: native bridges](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges),
  [JavaScript bridge guide](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge),
  [PermissionRequest](https://developer.android.com/reference/android/webkit/PermissionRequest))

The desktop app already works this way (ADR 0082), including Google sign-in through the system browser and a PKCE-bound
deep link, because Google refuses OAuth inside an embedded WebView.

## Decision

**The signed-in Android app is the web app in a WebView.** Every screen the person sees (home, cameras, live view,
activity, clips, settings, add a device, sharing, sign-in, recovery) is the React app, so Android and the web are the
same by construction and a change reaches both at once.

**What stays native, because a web page cannot do it:**

- the camera agent: the camera foreground service, CameraX capture, the WebRTC producer, privacy mode, motion detection,
  clip capture and upload, and the visible camera screen (a camera must keep running with the screen off, which a web
  page cannot do);
- credentials for the device (the keystore-backed camera credential and pairing);
- push notifications (FCM) and the restart reminder, which open the web app at the right page;
- the app update check for sideloaded installs, and the Google sign-in hand-off through the system browser.

**The bridge** is one origin-restricted `WebMessageListener` named `BeaconNative`, allowed only for the Beacon web origin.
The web app detects it and, when present: starts the native camera for "This device" instead of the browser camera, shows
the app version and update state, hides the "Get the Android app" prompts, and opens the native camera screen. It exposes
a short fixed list of messages, each validated; there is no generic call. No `addJavascriptInterface`.

**The WebView is locked down:** only the Beacon origin loads inside it (everything else opens in a Custom Tab), JavaScript
runs only for that origin, no file or content access, no mixed content, Safe Browsing on, third-party cookies off,
debugging only in debug builds. Camera and microphone are granted to the page only for the Beacon origin, only the
resource asked for, and only when the Android permission is held.

**Google sign-in** reuses the desktop flow: the system browser runs the consent screen and returns through
`beaconsecureview://auth/...` carrying a code bound to a PKCE challenge whose verifier stays in the app; the app redeems it
from inside the WebView so the session cookie lands there.

## Consequences

- The native Compose monitor (home, cameras, live view, activity, clips, settings, sharing, auth screens) is deleted once
  the WebView covers it. That removes most of the Android UI code and its duplicate bugs.
- The UI needs the network. The web app's service worker keeps the shell, and the WebView shows a native "can't reach
  Beacon" page with Retry when it cannot load.
- Android-only touches (picture in picture, saving a snapshot to Photos, haptics) become bridge messages added one by one;
  none ships until it is validated and tested.
- The app is no longer "a native app" in the sense Google Play reviews, but it adds a camera agent, push and system
  integration, which is the usual bar for a wrapper. The sideload route is unaffected.
- A fix to the web UI now ships to Android phones on the next web deploy, without a new APK, except bridge changes.

## Stages

1. **Spike (this ADR):** a WebView host that loads the web app, signs in with a password, shows the dashboard and plays a
   live view on the emulator. Done when screens match the web's.
2. **Bridge and camera:** "This device" starts the native camera; privacy and status; permissions; downloads; deep links
   from push and the pair link; error page.
3. **Google sign-in** through the system browser.
4. **Remove** the native monitor UI and its tests; keep the camera agent.
5. **Ship** as the next alpha with device-checked notes.

### Stage status

1. Spike: done (emulator, 2026-10-12).
2. Bridge and camera: done and checked on emulators (sign-in, dashboard, live view, This phone settings, Add device to native camera, push, downloads, deep links).
3. Google sign-in through the system browser: done (PKCE hand-off, `beaconsecureview://auth/desktop`).
4. Native monitor UI removed; the camera agent, pairing, privacy, push delivery and update check remain.
5. Ship: pending. The web app is deployed first, then the APK is built with `BEACON_RELEASE_API_URL`/`BEACON_RELEASE_WEB_URL` set, and checked on a real phone.
