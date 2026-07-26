# Multi-camera monitoring

## Architecture

The Monitor route composes one existing WebRTC viewer lifecycle per camera tile.
Every tile owns its WebSocket, peer connection, retry generation, timeout, and
cleanup. React keys use stable public camera-source IDs, so filtering and
reordering do not replace unaffected tile components or restart their streams.
A failed or reconnecting camera therefore cannot create a global loading state.

The backend signaling and authorization model is unchanged. Each viewer
connection remains independently authorized for its camera source. No media is
proxied through the web application and no recording is created.

## Performance

The default `visible` refresh preference uses `IntersectionObserver` with a
small preload margin. A distant tile closes its viewer session and reconnects
when it approaches the viewport. All tiles close viewer sessions while the
document is hidden. Users may choose continuous offscreen connections for a
fixed monitoring display, but hidden browser tabs still disconnect to avoid
wasting device, TURN, and network capacity.

Camera metadata continues to use the single household realtime subscription in
the application shell. Tiles do not add duplicate metadata subscriptions.

## Tile behavior

Tiles show only reported camera, device, presence, streaming, and viewer data.
Offline, disabled, and revoked sources do not initialize WebRTC. Source
switching updates only the selected tile after the activation request succeeds.
Stable sibling tiles remain mounted.

Android and browser producers commonly capture only one source per device.
Putting sibling sources from such a device into the same workspace may cause
one tile to become unavailable when another source is activated. Beacon
describes this constraint and does not imply concurrent hardware capture.

## Responsive and accessible behavior

Large screens use up to four dense columns, tablets use two columns, and phones
use one column without horizontal scrolling. Tiles are keyboard focusable,
controls have accessible names, reordering has arrow-button alternatives to
drag and drop, and Escape exits an expanded tile. Expanded tiles retain camera
identity, device access, viewer count, source selection, and application
navigation behind the dismissible monitoring layer.

## Capacity boundary

A 16-tile workspace can establish 16 independent peer connections. This is an
operator feature, not a promise that every old phone, browser, Wi-Fi network, or
TURN deployment can sustain that load. Production capacity testing must measure
producer encoding, uplink, relay bandwidth, browser decode, thermals, and power
before publishing supported-camera limits. An SFU remains a future option and
is not introduced by this milestone.
