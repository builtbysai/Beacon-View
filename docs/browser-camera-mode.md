# Browser Camera Mode

Browser Camera Mode is an attended producer at `/camera-mode`. It is a
first-class Beacon device, can register several webcam sources, and publishes
the selected source to independently authorized viewers.

## Use

1. Open the visible **Camera Mode** navigation item over trusted HTTPS.
2. Select **Allow and find cameras** and approve the browser prompt.
3. Name the browser device and selected source.
4. Select **Start camera**. The preview and viewer count confirm activity.
5. Use **Switch camera** without pairing again, or **Stop camera** to release
   capture.

The local installation identifier is an application mapping, not an
authentication secret. Authentication remains the HttpOnly household cookie.
Media, TURN credentials, SDP, and raw ICE candidates are not stored.

Browsers may throttle or suspend hidden tabs. Camera Mode warns while hidden
and offers an explicit Screen Wake Lock where supported, but does not claim the
always-on reliability of Android's foreground service. Keep the page visible
for attended use. Producer and viewer roles can coexist in separate tabs,
subject to browser and camera-driver concurrency limits.

Camera device IDs can change when permissions, profiles, or site data reset.
Beacon retains one installation ID per browser profile and maps currently
visible source IDs beneath it. Camera permission is never granted silently.
