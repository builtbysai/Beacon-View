# ADR 0067: Camera QR setup and device integration foundation

Date: 2026-09-24

## Context

The public browser camera route accepts a one-time pairing code but required typing it. The pairing dialog had a generic setup link that first opened the Android-oriented `/pair` page. Guest link loading also labeled temporary network failures as expired links. Future IoT support needs a clear boundary before any third-party protocol or credential is added.

## Decision

The signed-in household member can copy a direct `/camera-mode/setup?code=...` link. The existing generic pairing QR remains available for Android and browser devices. Public browser setup can scan that QR or the direct browser link and extracts only a valid one-time code from a same-origin Beacon route. It never follows a scanned URL. The scanner runs only after an explicit user action and stops its camera when dismissed or when a code is accepted. Manual entry remains available.

Guest links distinguish an expired or revoked grant from temporary connectivity failure, with a retry for the latter. A failed background refresh does not falsely claim that the grant expired.

`@beacon/shared-types` now defines a prospective device integration contract: transport, capabilities, revocable user enrollment, capture indication, and media handling. It is a compile-time planning boundary only. No third-party device is discoverable, enrollable, controllable, or authorized by this change.

## Requirements before the first IoT adapter

1. Select a device class and protocol, document its threat model and authentication flow, including credential storage, rotation, and revocation.
2. For any camera, prove that capture is visible at the physical source and that privacy mode stops it immediately. A device that cannot meet this requirement cannot be a Beacon camera source.
3. Define least-privilege data and control scopes, retention, deletion, vendor outage behavior, and local-network request restrictions before any server-side network access.
4. Extend the household authorization model and database platform constraints in a reviewed migration. Keep guest grants explicit and narrow.
5. Test real hardware or a protocol-conformant simulator, including revoked access and interrupted connections, before exposing setup UI.

## Consequences

Pairing links remain bearer secrets with a ten-minute lifetime and should be shared only with a device the user is authorized to enroll. A scanner needs browser camera permission. The new type contract provides a reviewable place to specify future adapters, but it is not evidence that an IoT integration is supported.
