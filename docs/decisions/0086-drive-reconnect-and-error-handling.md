# ADR 0086: Google Drive reconnect flow and consistent error handling

- Status: Accepted (owner-requested October 7, 2026)
- Date: 2026-10-07

## Context

Recordings failed in production because Google stopped accepting the Drive
refresh token (`invalid_grant`). OAuth apps in Testing mode get refresh
tokens that expire after 7 days. The owner first learned of it from a
generic "temporarily unavailable" error, after recording a whole clip. The
owner asked for a better reconnect flow, and for better error handling
across the app.

A review found these gaps:

- **Expiry was forgotten.** An expired connection was deleted, so Settings
  said "Not connected" rather than "Expired". Nothing checked the token
  before a recording started.
- **The web client lost error detail.** It kept only the server's `error`
  text. Codes were dropped, and network failures surfaced as the browser's
  raw "Failed to fetch".
- **Start-up treated every failure as signed out.** A network blip or
  server error during the session check sent signed-in people to the
  sign-in screen.
- **Lapsed sessions had no central handling.** Each screen showed its own
  "Authentication required".
- **There was no React error boundary.** Any render error left a blank
  page.
- **The backend leaked error messages.** It used Fastify's default error
  handler, which puts an unexpected error's message in the 500 response.

## Decision

### Drive connection health (backend)

- `google_drive_connections.expired_at` (migration 0033) marks a connection
  Google no longer accepts.
  - Expired rows read as absent everywhere: recordings, backups, and
    motion-triggered clips can never use a dead token.
  - Only the status endpoint asks whether a connection expired.
  - Reconnecting clears the mark; disconnecting deletes the row.
- One `DriveHealth` service owns every token refresh.
  - Only an explicit `invalid_grant` marks expiry, and the expiry is
    audited once (`google_drive_connection_expired`).
  - Transient failures never block or disconnect anything.
  - A confirmed-live token is trusted for an hour.
- `POST /api/recordings` checks Drive before anyone records. Every
  Drive-backed route answers owner-fixable problems with
  `409 { code: 'drive_not_connected' | 'drive_reconnect_required' }`.
- Playback tells three audiences apart. The Drive owner is asked to
  reconnect. Other members get `recording_storage_unavailable` ("ask the
  owner"). Share-link guests get a neutral message.
- The start endpoint keeps the exact text "Connect Google Drive for
  recordings first". Android's `BeaconApi.startRecording` matches on that
  text. It can move to `code` later.

### Reconnect flow (web)

- `useDriveRecording` tracks readiness while a record control can be on
  screen. It re-checks on focus.
- When Drive can't take recordings, the record button becomes "Connect" or
  "Reconnect Google Drive to record".
- Connecting never leaves the page:
  - **Browser:** Google's consent opens in a popup. The popup reports back
    with a same-origin `postMessage` and closes. The page also polls status
    every 3 seconds for up to 10 minutes.
  - **Desktop app:** the shell sends consent to the system browser
    (ADR 0082). Polling notices completion.
  - **Installed PWA:** it uses the same window, because a popup would open
    in a browser that isn't signed in.
- A clip that hits a Drive problem at upload is **kept in memory**. A
  notice says so ("Waiting for Drive" badge) and offers Reconnect. The clip
  uploads by itself, once, when Drive is ready again.
- A failure with nothing kept to upload no longer offers a "Retry upload"
  that could do nothing. The button offers a fresh recording instead.

### App-wide error handling

- **Backend:** one error handler.
  - Unexpected errors are logged in full. The response is a generic message,
    `code: 'internal_error'`, and the request ID.
  - Framework 4xx errors get plain messages and codes. Unknown routes return
    JSON 404.
  - 401s carry `code: 'session_required'`.
- **API client:**
  - `ApiError` keeps `code` and `requestId`.
  - Network failures and timeouts become `status: 0` with a plain message.
    The default timeout is 60 seconds; a caller's own cancellation is passed
    through.
  - Bodies without a message get status-based wording.
  - `session_required` fires one `beacon:session-ended` event. The app then
    returns to sign-in with a reason. A wrong password never fires it.
- **Start-up:** only a 401 shows sign-in. Other failures show "Can't reach
  Beacon" with Try again, which also retries when the device comes back
  online. If the session check succeeds but the camera list fails, the app
  stays signed in and reports the failure.
- **`AppErrorBoundary`** shows Reload / Go to Home instead of a blank page.
- Remaining unhandled promise chains are handled (camera-list refreshes, the
  push-subscription probe).

## Consequences

- An expired Drive connection is noticed before recording starts, from a
  status check (hourly at most), or at the first Drive call.
- The held clip lives in memory only. Closing the tab before reconnecting
  discards it, and the notice offers Discard explicitly. Persisting held
  clips (IndexedDB) is possible later if needed.
- Long-running API calls must finish within 60 seconds or use their own
  fetch (uploads already do).
- Owner action still required: publish the Google OAuth consent screen to
  **In production**. Otherwise tokens keep expiring every 7 days, though the
  app now handles it gracefully.
