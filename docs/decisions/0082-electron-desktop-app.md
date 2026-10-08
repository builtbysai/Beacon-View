# ADR 0082: Ship an Electron desktop app that runs the PWA and stays in the tray

- Status: Accepted for the desktop-app milestone (owner-approved October 6, 2026)
- Date: 2026-10-06

## Context

The roadmap deferred "cross-platform installed clients" until an owner-approved
milestone. On October 6, 2026 the owner approved a dedicated desktop app for
Windows, macOS, and Linux. The requirements: it must look exactly like the PWA,
and it must keep running in the background. iOS was considered and deferred (see
below).

`docs/cross-platform-and-iot-research.md` (September 26) recommended Tauri for a
thin wrapper. Two facts found during this milestone's research reverse that:

- Tauri renders with each OS's own webview. On Linux that is WebKitGTK, and
  **WebKitGTK 2.54 (September 2026) disabled WebRTC** while its backend moves
  from GStreamer to LibWebRTC. Live view, Talk, and Browser Camera Mode all
  require WebRTC, so a Tauri Linux build would load the dashboard but play no
  camera. The workarounds are a third-party Rust WebRTC polyfill plugin or
  waiting for an unscheduled WebKitGTK release.
- Tauri's `backgroundThrottling` control works only on macOS 14+ (and iOS 17+).
  It is unsupported on Windows and Linux, which are exactly where a tray-resident
  camera needs it.

Other constraints that shaped the design:

- The web viewer authenticates with host-scoped, same-origin session and CSRF
  cookies (`credentials: 'same-origin'`). A copy bundled on a `file://` or custom
  origin could not use them.
- Google refuses OAuth inside embedded user agents (RFC 8252). Beacon's web flow
  is a full-page redirect through `/api/auth/google`, which would fail inside an
  app webview.
- Electron, like WebView2, has no push service: `PushManager.subscribe()` fails.
  Web Push alerts therefore cannot work inside the app.

## Decision

1. **Electron (44.x) for Windows, macOS, and Linux.** Chromium is bundled, so
   rendering and WebRTC are identical on every OS, and `backgroundThrottling:
false` works everywhere. The costs (roughly 110 MB installers, and shipping
   Electron security releases) are accepted in exchange for that consistency.
2. **The window loads the canonical origin** (`https://beacon.builtbysai.com`).
   It does not bundle a copy. The UI is the PWA itself, byte for byte. Cookies,
   CSRF, and the service worker behave as they do in a browser, and server
   deploys update the app UI without version skew. Packaged builds hard-code the
   origin. Unpackaged development builds accept `BEACON_DESKTOP_ORIGIN` for HTTPS,
   loopback, or private-network HTTP only (ADR 0005).
3. **Only Beacon renders in the window.**
   - Top-level navigations, redirects, and new windows go through one tested
     policy (`apps/desktop/src/navigation-policy.ts`). Same-origin pages stay in
     the window. Other `https`/`http`/`mailto` links open in the system browser.
     Everything else is blocked.
   - Subframe navigation off the origin is blocked, and `<webview>` is never
     allowed.
4. **Least privilege.**
   - All renderers run with `sandbox`, `contextIsolation`, and no Node
     integration.
   - The preload exposes exactly one frozen object, `window.beaconDesktop =
{ version: 1, setCaptureActive(boolean) }`. The main process honors it only
     from the Beacon origin's main frame.
   - Web permissions are limited to camera/microphone (`media`), clipboard write,
     and fullscreen, for the Beacon origin. Notifications, geolocation, screen
     capture, and HID/USB/serial devices are denied.
   - macOS additionally gates media through TCC (`askForMediaAccess`) using the
     declared usage strings.
   - Packaged builds set these Electron fuses: no `ELECTRON_RUN_AS_NODE`, no
     `NODE_OPTIONS`, no `--inspect`, cookie encryption at rest, embedded ASAR
     integrity validation, load only from ASAR, and no extra `file://`
     privileges.
5. **Google sign-in runs in the system browser with PKCE.** When the app sees
   navigation to `/api/auth/google`, it cancels it, creates an RFC 7636 S256
   verifier/challenge pair, and opens
   `/api/auth/google?platform=desktop&challenge=…` in the person's browser. The
   backend embeds the challenge in the OAuth `state`. On callback it issues a
   single-use, 10-minute handoff code bound to that challenge and redirects to
   `beaconsecureview://auth/desktop?code=…`.
   - The app accepts the link only while it has a sign-in pending, and spends its
     verifier once.
   - It redeems the code with `POST /api/desktop/auth/google` from inside the
     Beacon page, so the session cookie lands in the app's own cookie jar.
   - The endpoint requires a JSON body and an `x-beacon-desktop: 1` header. Both
     force a CORS preflight that the API never grants, which blocks login CSRF
     from other sites.
   - A redemption attempt consumes the code even when the verifier is wrong.
   - An existing password account with the same email gets the same pending-link
     treatment as the web: the pending link travels with the handoff into the
     app's webview.
   - Account linking and Google Drive connection need the existing session. The
     app sends the person to Beacon Settings in their browser to finish those,
     with an explanation.
6. **Background running is visible.**
   - Closing the window hides it to the tray. Only **Quit Beacon** (tray, or the
     OS quit command) exits.
   - A single-instance lock forwards second launches and Windows/Linux deep links
     to the running app.
   - **Start Beacon when I sign in** is off by default. When on, it launches
     hidden with `--background`. It uses the login item on Windows and macOS and
     an XDG autostart entry on Linux.
   - While Browser Camera Mode broadcasts, the web viewer reports it through the
     bridge. The tray icon gains a red live dot, the tooltip and menu say "Camera
     Mode is live", a notification fires if the window is hidden, an OS
     `prevent-app-suspension` power lock is held, and quitting asks for
     confirmation. This is the desktop counterpart of Android's foreground-service
     notification (ADR 0047).
   - Any full navigation, reload, or renderer crash clears the indicator. Talk
     already stops when the page is hidden.
7. **Alerts are not claimed.** Inside the app, the web viewer's notification
   setting shows "Unavailable" and explains that alerts need Chrome, Edge, or the
   Android app. A desktop alert transport that honors server-side preferences and
   quiet hours (ADR 0044/0055) is a separate follow-up.
8. **Distribution.**
   - electron-builder produces an NSIS per-user installer (Windows x64/arm64), a
     DMG (macOS x64/arm64, hardened runtime with camera/microphone entitlements),
     and an AppImage plus a `.deb` (Linux x64).
   - Installers register the `beaconsecureview` scheme.
   - Builds are unsigned and have no auto-update channel until the owner decides
     on certificates and update hosting.

## iOS

iOS is deferred. No framework works around Apple's background-execution rules.
An iPhone cannot act as a background camera, and a suspended viewer cannot hold a
live connection. A native app also needs a Mac to build, an Apple Developer
membership, and App Store review. Review commonly rejects apps that only wrap a
website (guideline 4.2). The installed PWA already supports Web Push on iOS 16.4+.
A native iOS client (Capacitor or Swift with APNs) needs its own milestone.

## Consequences

- One Electron codebase serves three desktop OSes with the exact PWA UI and full
  WebRTC.
- The backend must be deployed before desktop Google sign-in works. Until then,
  production rejects `platform=desktop` with 400 and the person sees the web
  viewer's existing failed-sign-in message. Email/password sign-in works
  immediately.
- Desktop Google handoff codes live in process memory, like Android's (ADR 0003
  single instance). A backend restart during the roughly one-minute browser
  round-trip fails that sign-in, and the person retries.
- Electron security releases must be shipped as app updates. Until auto-update
  exists, that means re-downloading the installer. This needs an owner decision
  on update hosting and code-signing cost before public distribution.
- Unsigned builds trigger Windows SmartScreen and macOS Gatekeeper warnings.
- Stock GNOME hides tray icons unless the AppIndicator extension is installed. On
  those desktops, launching Beacon again reopens the hidden window.
