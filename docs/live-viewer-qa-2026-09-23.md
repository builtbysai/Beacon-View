# Live Viewer and Browser Camera QA, 2026-09-23

## Environment

- Windows development checkout; `adb devices -l` reported no attached devices.
- Oracle backend and web were healthy at the Activity release, but production
  data was left untouched for this QA pass.
- Browser camera and signaling cases below were exercised with mocked media,
  WebSocket, and WebRTC APIs in the web test suite. They are not physical media
  acceptance tests.

## Verified in code and automated tests

- Browser Camera registers discovered sources, uses the server's canonical
  names, starts an explicit capture, and stops tracks on normal shutdown.
- A media request resolving after the page unmounts now stops its tracks
  immediately. A failed source switch retains the current capture and selected
  source. Signaling authorization loss closes peers and stops local capture.
- Browser producer tests cover independent viewers, stale reconnect
  cancellation, source switch signaling, and authorization loss.
- Live viewer tests cover reconnect state, source switch failure, viewer count,
  Listen and Talk permissions, privacy gating, and media transport failure.

## Physical acceptance still required

With the Pixel and at least one real browser camera available, verify Android
and browser camera connection, WebRTC negotiation, TURN relay, reconnect after
network loss, page refresh recovery, disconnect, source switching, multiple
sources, viewer counts, privacy transitions, source removal, stale session
cleanup, and capability-dependent Listen, Talk, Flip, Pause, and source
selection. Record device/browser versions and outcomes before considering this
physical-device milestone complete.
