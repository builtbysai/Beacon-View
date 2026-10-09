# ADR 0097: Cast to TV

- Status: Accepted (convenience batch item C8, approved October 9, 2026)
- Date: 2026-10-09

## Context

A live WebRTC stream cannot go through the browser Remote Playback API, and
a Chromecast runs only registered receiver applications. The earlier plan
(ADR 0089) left C8 open for that reason. The owner approved building it.

## Decision

- **Receiver.** A small Beacon receiver page at `/cast/index.html` runs on
  the TV. It uses Google's Cast Web Receiver framework, listens on one custom
  namespace, and opens the one path it is sent inside a frame on its own
  site. It only accepts `/g/<token>?cast=1`, a guest link in cast mode,
  and ignores everything else. The receiver stays awake (no idle timeout).
- **Sender.** The web viewer (Chrome-based browsers, including Chrome on
  Android; not the desktop app) shows a Cast button on a camera's live view
  to owners and admins. It loads Google's sender framework, lets the person
  pick a TV, then creates a **view-only guest link for that one camera**
  (4 hours, no listening, talking, flipping or pausing, labelled "Cast to TV")
  and sends its path to the receiver. Stopping, leaving the camera, or the TV
  session ending revokes the link. A link that nobody stops expires after
  four hours.
- **No new viewing mechanism.** The TV watches through the existing guest
  link path (ADR 0048): scoped cookie, audit entries, the household's guest
  link list, rate limits, and revocation. Capture indicators on the camera
  device are unchanged. Casting only shows what a signed-in owner or admin
  chose to show.
- **Configuration.** The Cast application is registered by the owner in the
  Google Cast SDK Developer Console as a custom receiver pointing at
  `https://<domain>/cast/index.html`. Its 8-character ID goes in
  `CAST_APP_ID`. Until it is set the button is hidden; the server tells
  signed-in viewers the ID through `GET /api/cast-config`.

## Consequences

- No migration. One optional setting and one read-only endpoint.
- The sender and receiver load Google scripts from `gstatic.com`. Nothing is
  sent to Google beyond the Cast protocol itself; live video uses the existing camera-to-TV WebRTC path, direct or TURN-relayed.
  Beacon's backend handles authorization/signaling, not a new video relay.
  This describes the intended media path, not a claim that Google SDKs collect
  no telemetry or a verified end-to-end-encryption guarantee.
- Not included: an Android-app sender (it needs the Cast SDK and Google Play
  services in the camera app) and a desktop-app sender (Electron has no Cast
  support). Both can reuse the same receiver and link flow later.
- Verified with a fake Cast framework on both ends in a real browser (button,
  link creation, message, receiver playing the live camera, no controls,
  revocation). The Google sender and receiver frameworks and a real
  Chromecast need the registered application ID and could not be exercised.
