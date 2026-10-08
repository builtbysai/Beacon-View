# ADR 0070: Recording failure recovery

- Status: Accepted for the active recording completion milestone
- Date: 2026-09-25

## Context

A browser or Android camera could create a recording request and then fail before completion. The local client discarded its media, but the backend retained the recording in `requested` or `uploading`. That blocked later motion recordings for the camera and left the owner with a status that could never resolve.

## Decision

Browser and Android capture paths report terminal failures through dedicated endpoints. Browser reports require an authenticated owner session and CSRF token. Android reports require the device credential that belongs to the recording's camera. Both transitions accept only active `requested`, `recording`, or `uploading` rows and move them to `failed`.

An hourly recovery job handles clients that lose power or connectivity before reporting. Requests left in `requested` or `recording` for 15 minutes and uploads left in `uploading` for two hours become `failed`. These windows exceed the ten-minute clip limit and allow a large encrypted upload to finish on a slow connection. Owners can remove failed entries from the recording library.

## Consequences

Failed capture no longer blocks later motion recording indefinitely, and the library shows a clear terminal state. Failure reporting is best effort; the scheduled recovery job is the durable fallback. This milestone does not resume partial Drive uploads or distinguish quota exhaustion from provider disconnection in the owner interface. Those cases still need provider-specific retry guidance and physical acceptance testing.
