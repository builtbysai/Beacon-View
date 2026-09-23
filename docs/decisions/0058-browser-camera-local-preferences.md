# 0058: Browser Camera local preferences and stable identity

## Decision

Browser Camera stores its generated installation ID, display name, and
keep-awake preference in browser storage. The installation ID is needed to
reconnect registration to the same physical browser device; when storage is
blocked, setup explains the requirement and stays available for retry. The
keep-awake checkbox appears only when the browser offers the Screen Wake Lock
API. If the API rejects a request, Camera Mode continues and clears the
preference with a visible warning.

The selected camera's browser `deviceId` is not persisted. Browser device IDs
can change with permission and privacy state, and storing a hardware-derived
identifier is unnecessary for the current setup. The user chooses a source
after granting camera permission. User-owned source names remain stored by the
backend and device synchronization does not overwrite them.

## Consequences

Display name and keep-awake choices survive reload when storage is available.
Camera capture still starts only through an explicit user action; no media
stream or credential is stored in browser storage. A browser that blocks
storage cannot register a stable Camera Mode installation until its settings
allow storage.
