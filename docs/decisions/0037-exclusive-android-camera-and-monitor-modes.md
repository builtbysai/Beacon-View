# ADR 0037: Exclusive Android Camera and Monitor modes

Status: Superseded by [ADR 0121](0121-android-hosts-the-web-app.md): the Android app no longer has a native monitor mode; the web app is the viewer.

## Context

The Android app can act as the camera agent or as a native single-camera monitor. The
saved Monitor destination did not stop the foreground camera service, and activity
startup restarted that service whenever pairing and permissions were present. A phone
could therefore capture while showing the Monitor interface. Viewing that phone's own
stream also ran encoder and decoder resources together and exposed a native WebRTC
double-disposal crash followed by a UI-thread teardown ANR during repeated testing.

## Decision

Camera and Monitor are exclusive Android destinations. Selecting Monitor stops the
foreground service, which releases capture and signaling resources. Activity startup
honors the saved destination and never starts capture in Monitor. Selecting Camera
starts the service after the existing pairing and permission checks.

WebRTC camera peers are disposed exactly once before shared media is released. Native
viewer teardown marks the session closed synchronously, then releases its peer,
factory, renderer and EGL resources on a cleanup thread so navigation is not blocked
by native shutdown work.

## Consequences

The visible screen now agrees with whether the phone is capturing, and a user cannot
monitor the same phone while it is acting as a camera. Its sources may remain shown as
online briefly until backend presence expires, but they cannot open once offline.
Monitoring another paired device remains supported. Multi-camera native playback and
simultaneous capture/monitor operation remain separate capacity and privacy decisions.
