# 0059: Partial Diagnostics results

## Decision

The Diagnostics route fetches camera sessions and physical devices
independently. If one lookup fails, it returns the healthy section and names
the unavailable section in an `unavailable` array. If both lookups fail, it
returns a generic 503 error. The web page distinguishes unavailable from an
empty result and provides Retry for both partial and total failure.

The owner/administrator permission check remains before either lookup. The
response does not expose exception messages, credentials, SDP, ICE candidates,
or household IDs.

## Rationale

An empty list means no devices or sessions were found. A failed lookup cannot
be presented as empty without misleading the person debugging the system.
Independent lookups also allow the healthy information to remain usable while
one dependency recovers.
