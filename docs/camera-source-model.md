# Camera source model

A camera source is an independently addressable child of exactly one device.
Its public ID, signaling authorization, enabled state, viewer count, and
lifecycle do not replace device identity.

The operational lifecycle is:

`registered -> available -> enabled -> idle -> streaming`

Additional states are `unavailable`, `disabled`, `switching`,
`permission-required`, `removed`, and `error`.

Renaming and disabling one source never modifies siblings. Disabling preserves
the source record but immediately closes that source's producer and viewers.
Deleting marks the source removed so ordinary hardware re-enumeration cannot
silently recreate a user-deleted registration. The parent device and sibling
sources remain.

When a device supports one capture at a time, source activation is sent over
the existing authenticated producer signaling socket. The producer releases
the prior CameraX or browser media stream before opening the selected source.
The live page stays mounted and enters `switching source`, but WebRTC is
renegotiated because the stable signaling/media identity is per source. This
preserves the device workflow without pretending that two distinct source
sessions are one peer connection.
