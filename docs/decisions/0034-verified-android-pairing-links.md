# 0034 — Verified Android pairing links

## Status

Accepted for the private alpha.

## Context

An owner needs a simple way to hand a spare Android phone to someone setting up
a camera. A browser cannot reliably or privacy-respectfully detect whether a
native app is installed. Pairing credentials are short-lived capabilities and
must not be widened into a reusable device-registration mechanism.

## Decision

Beacon QR codes and the copyable setup control use
`https://beaconapp.duckdns.org/pair?code=<one-time-code>`. Android declares a
verified App Link for that exact host and path. When Beacon is installed and
the operating system verifies the association, Android opens Beacon; otherwise
the browser shows a compact fallback with the manual code. The Android app
accepts only HTTPS pairing links whose host matches its configured API origin,
then still requires the user to tap **Pair device**.

The web build serves the Digital Asset Links statement at
`/.well-known/assetlinks.json`. It currently includes the private-alpha debug
certificate used to install the connected Pixel. A production release must add
its release/Play signing SHA-256 fingerprint before release; it must not
replace the existing fingerprint while that alpha build remains supported.

The old `beacon://pair` QR format remains accepted by the Android scanner for
backwards compatibility, but new links use HTTPS.

## Consequences

- No app-installed probing, custom browser intent URL, or fingerprinting is
  needed.
- The browser fallback is intentionally not a browser camera replacement;
  Browser Camera Mode remains an explicitly attended, temporary option.
- A future owned domain requires: serving the same association file on the new
  hostname, adding that hostname to the Android intent filter, rebuilding the
  Android app, and keeping the DuckDNS association until existing clients have
  migrated.
- The code is a one-time, ten-minute pairing capability. Owners should share it
  only with a person authorized to add a camera to their household.

## References

- [Android App Links overview](https://developer.android.com/training/app-links/about)
- [Android Digital Asset Links configuration](https://developer.android.com/training/app-links/configure-assetlinks)
