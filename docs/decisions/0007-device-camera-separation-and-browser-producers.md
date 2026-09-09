# ADR 0007: Separate devices from camera sources and admit browser producers

- Status: accepted
- Date: 2026-07-25

## Context

The first Android implementation used one `cameras` row for a physical device,
its credential, and its single rear source. That model cannot accurately
represent front/rear lenses, multiple webcams, browser producers, or a future
device that produces and views simultaneously.

## Decision

Model a household-owned device separately from its camera sources. Retain the
historical `cameras` SQL table as the device table so existing credentials and
pairing references remain valid, and add `camera_sources` with independent
public IDs. Migrate every existing device to one default source.

Authorize signaling for the exact camera source. Android and attended HTTPS
browsers may be producers. A producer owns one shared capture and an independent
peer connection per viewer. Current Android and browser implementations publish
one selected source at a time, while capabilities preserve a future concurrency
decision.

## Consequences

Existing phones do not pair again, but old camera public IDs become device IDs;
new camera-source IDs are used for live-view URLs and signaling. Browser
producers inherit browser background-throttling constraints and are not an
always-on replacement for the Android foreground service. Peer-to-peer fan-out
still needs device performance limits and remains replaceable by a future SFU.
