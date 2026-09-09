# Device management

The Devices page is the operational center for a device and its child sources.
All state-changing APIs require the authenticated household session and CSRF
token. Inventory and diagnostics remain household scoped.

## Device actions

- Rename: changes display text only.
- Disable/enable: preserves registration; disabled devices cannot publish or be
  viewed.
- Restart session: closes producer and viewer signaling so an enabled producer
  reconnects normally.
- Revoke: invalidates credentials, closes all child sessions, and requires
  pairing again.
- Delete: after explicit confirmation, closes sessions and removes the device,
  credential, sources, and dependent registration records.

Deletion confirmation warns when viewer counts are nonzero. Revocation and
deletion are deliberately separate operations.

## Source actions

Sources can be renamed, disabled/enabled, restarted, opened, diagnosed, or
deleted. Source actions affect only the selected source. Remote activation of a
sibling is sent to the connected producer, which coordinates exclusive capture.

Realtime household events refresh Devices, Cameras, Device Detail, Live View
inventory, and viewer counts without a manual reload. Events contain public
camera identifiers or generic management-change categories, never credentials.

## API summary

- `PATCH /api/devices/:deviceId`
- `POST /api/devices/:deviceId/restart`
- `POST /api/devices/:deviceId/revoke`
- `DELETE /api/devices/:deviceId`
- `PATCH /api/cameras/:cameraId`
- `POST /api/cameras/:cameraId/activate`
- `POST /api/cameras/:cameraId/restart`
- `DELETE /api/cameras/:cameraId`
