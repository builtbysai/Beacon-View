# ADR 0066: Public browser camera pairing

Date: 2026-09-24

## Context

Browser Camera Mode required a signed-in owner or administrator on the camera device. That made a spare browser awkward to set up, and leaving Camera Mode made a local browser camera appear to need an Android-style reconnect. Guest links and guest household memberships also lacked clear lifecycle feedback in the web UI.

## Decision

A signed-in household member still creates the existing one-time, ten-minute pairing code. A browser at `/camera-mode/setup` can redeem it without signing in. Redemption creates a browser-platform device and its camera sources in one database transaction, consumes the code, and issues a device credential in an HttpOnly, SameSite=Strict, `/api` cookie. The browser never receives the credential in JSON or a URL. Producer signaling accepts that cookie only from the configured web origin and continuously checks the credential and camera; the existing session authorization path remains available for signed-in browser producers.

The browser stores only the public device ID and a random installation ID locally. The public device ID selects a local “Continue as camera” action on Monitor and Home. On the public setup route, a valid cookie and matching installation ID can restore source registration without another pairing code. A revoked credential, cleared cookie, or cleared installation storage requires a fresh code.

Guest links continue to grant view-only access to their selected cameras. The guest page rechecks its scoped camera list while visible and shows expiry or revocation after the next check. It provides an explicit exit action. Signed-in guest members see a pairing-code explanation instead of camera management controls.

## Consequences

One browser installation represents one camera device. A second household or a cleared credential may require deleting the old device and pairing a new installation. The camera browser must remain open for capture; navigation away stops its media tracks. The cookie is a producer credential, so production must keep HTTPS, origin checks, short pairing expiry, revocation checks, and cookie redaction in request logs. No account is required on the camera browser; an account remains required to create the pairing code and to view cameras outside a guest link.
