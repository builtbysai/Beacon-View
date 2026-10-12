# ADR 0117: One "Add a device" flow for every kind of device

- Status: Accepted (2026-10-12)

## Context

The add flow offered "Pair another device" (an Android phone), "Set up another computer" and "Use this device".
A computer is also a device, and "pair" was only one of three ways to add one, so the choices overlapped and
described the how instead of the what. Each led to a different dialog, and the pairing dialog showed one code
that served an Android phone, a browser camera link and a reconnect, all at once.

## Decision

Ask one question first, "which device will be the camera?", with three answers that never overlap:

- **This device**: use the camera in this browser or app now. On a computer or an Android phone it also offers the
  Beacon app for a camera that has to keep running.
- **Phone or tablet**: Android (install the app, then pair with a QR code or a typed one-time code) or iPhone and
  iPad (open the setup link in Safari; the page says plainly that Apple pauses web apps in the background, so
  the device should stay plugged in with the screen on).
- **Computer**: choose what the camera is for, then the one-download setup (Windows installer with the code
  inside, setup file or link for an installed app, or a plain browser link).

The steps appear on the same page below the choice, numbered, with the code already created (it lasts ten
minutes, with a countdown and a one-tap new code). When the camera connects, the app takes the owner to Cameras
with the new camera highlighted. The Android app asks the same question and shows the matching steps;
reconnecting an existing camera keeps its own pairing dialog.

## Why

Smart-home and camera apps ask for the kind of device first and then walk through its steps; the research notes
for this change also point at ready codes instead of buttons, specific failure messages, a camera-friendly
low-light QR scan, and naming the camera after it connects. Sources:
[IoT pairing best practices](https://2smart.com/docs-resources/articles/iot-device-pairing-best-practices),
[device onboarding guide](https://www.mfgrobots.com/Article/iiot/iot/10071.html).

## Not done

- iPhone and iPad have no native app; the Safari route is the honest limit.
- The Android app still cannot show the computer's installer; it sends the link to the computer instead.
