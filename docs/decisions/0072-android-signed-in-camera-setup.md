# ADR 0072: Signed-in Android camera setup

## Status

Accepted — September 25, 2026

## Context

Android Monitor could tell a signed-in user to set up the current phone as a
camera, but it sent them to the manual pairing screen. The user then needed a
second signed-in viewer to create the one-time code. This blocked recovery and
first-camera setup when the Android device was the only available viewer.

## Decision

The signed-in Android Monitor may request the existing authenticated one-time
pairing code and immediately consume it for the current installation. The
backend remains authoritative for household role checks, rate limits, code
expiry, installation binding, auditing, and credential issuance. Android stores
only the resulting device credential and keeps the account session separate.

Manual code and QR pairing remain available for unsigned-in camera devices.
Camera and microphone permissions, visible capture indicators, foreground
service behavior, privacy mode, and disconnect behavior are unchanged.

## Consequences

- A signed-in owner or administrator can set up the same phone as a camera
  without another viewer.
- Setup still creates and consumes a short-lived, single-use code, so it does
  not add an alternate device-registration trust path.
- Authorization or network failures return the user to manual pairing with an
  actionable error and do not start capture.
