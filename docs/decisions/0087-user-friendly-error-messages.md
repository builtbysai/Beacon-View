# ADR 0087: User-friendly error messages

- Status: Accepted (owner-requested October 8, 2026)
- Date: 2026-10-08

## Context

The owner asked for user-friendly error handling. A review found:

- **Raw server text on screen.** The web app showed the server's error
  strings verbatim, so people saw "CSRF validation failed", "Invalid motion
  settings", "Household owner access required" and "Recording state
  changed". There are 126 such strings.
- **The server strings are identifiers.** The Android app matches on them
  to show its own wording (`BeaconApi.kt`), and tests and logs use them. So
  rewording them on the server would break Android.
- **Display text used as logic.** The web app compared one message,
  `googleAccountExists`, as an identifier.
- **Browser wording leaked through.** Camera and microphone errors ("Could
  not start video source"), push errors and fetch errors appeared as the
  browser worded them. They didn't say whether the problem was permission,
  a missing device, or another app using it.
- **Talk gave no reason.** Talk failures all read "Talk unavailable."
- **A failed camera list looked empty.** The page said "Add your first
  device".
- **Errors outlived their page.** They stayed visible across navigation and
  couldn't be dismissed.
- **The desktop app came back to the wrong page after an outage.** Its
  offline page reconnected to Home, so a computer camera came back off.

## Decision

- **One table of plain wording on the client** (`friendly-errors.ts`).
  - The server keeps its strings, and the client translates them. This is
    the same approach Android already uses.
  - Every message says what happened and, where possible, what to do next.
  - Every message avoids blame and internal terms.
  - Unknown `Invalid …` strings get a generic "That didn't go through.
    Reload the page and try again." Server text that is already a sentence
    passes through.
- **Identifiers become codes.** `googleAccountExists` becomes
  `google_account_exists`, and screens compare `ApiError.code`, never
  display text. `ApiError.serverMessage` keeps the original string for logs
  and support.
- **`friendlyError(error, fallback)` is the one way screens word a caught
  error.**
  - API errors are already translated.
  - Browser errors (`DOMException`, fetch `TypeError`) are translated, never
    shown raw.
  - Beacon's own sentences pass through.
  - Everything else gets the screen's fallback. Fallbacks share one voice:
    "The name couldn't be saved. Try again."
- **`mediaErrorMessage(error, device)`** turns camera and microphone
  failures into a cause and a fix:
  - permission blocked: how to allow it
  - not found: connect or choose another device
  - in use by another app: close it
  - anything else: check the connection
- **Talk names its failures:**
  - `mic_blocked`: microphone permission
  - `mic_failed`: missing or busy microphone
  - `not_allowed`: this viewer's access excludes Talk
  - `unavailable`: not connected yet
- **Presentation:**
  - `ErrorNotice` has an icon, the message, an optional Try again, and
    Dismiss.
  - Page errors clear on navigation.
  - A failed camera list shows a retry notice instead of the empty state.
  - The "Can't reach Beacon" start-up screen gets proper spacing.
- **Desktop offline page:** it reconnects to the page that failed, such as
  Camera Mode. The return URL must be on the app's own origin. The inline
  script's CSP hash is updated.
- **A test reads every server error string** and fails if one would reach
  people untranslated. New server errors must get wording.

## Consequences

- New server error strings must be added to the table, or written as full
  sentences. The coverage test enforces this.
- Android keeps its own table. Moving both clients to codes later would let
  the server reword freely.
