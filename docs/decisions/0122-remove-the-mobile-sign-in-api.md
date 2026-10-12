# ADR 0122: Remove the mobile sign-in API

Status: Accepted (2026-10-12)

## Context

Before ADR 0121 the Android app had its own monitor: it signed in through `POST /api/mobile/auth/login`,
`/api/mobile/auth/register` and `/api/mobile/auth/google` and used the session as an `Authorization: Bearer` token
(which also skipped the CSRF check). The Android app now shows the web app and signs in with the same cookie session as
a browser, so nothing calls those endpoints. They were a second way to obtain and use a session that no client needed.

## Decision

- Remove the three `/api/mobile/auth/*` endpoints, the Android OAuth state and the in-memory mobile hand-off, and the
  `platform=android` start option. Android uses the desktop hand-off (`platform=desktop`, PKCE), as ADR 0121 describes.
- A signed-in session is accepted from its cookie only. `Authorization: Bearer` remains for device credentials, which
  have their own routes.
- Remove the web `/auth/mobile` return page and the Android manifest entries that received that link.

## Consequences

- A smaller authentication surface, and no route that bypasses CSRF for a user session.
- Android builds before alpha15 (the native monitor) cannot sign in any more; they are no longer offered for download.
- One regression test pins that a session token is refused as a bearer token and that the retired endpoints are gone.
