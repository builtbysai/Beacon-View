# ADR 0113: Owner decisions of 2026-10-11 (V43, V22, V70, V71)

- Status: Accepted

## Decisions

- **V43, alerts for viewers and guests.** Viewers can opt in to motion, camera-problem and offline
  alerts for the cameras they were granted; the alert pipeline checks the grant on every send, so
  removing a grant stops alerts at once. Owners and admins are unchanged. Guests get no alerts: they have
  no account to notify.
- **V22, device credential rotation.** A camera asks for a replacement credential after it is 30 days old
  (`POST /api/device/credential/rotate`). The old credential stays valid until the new one is first used, so
  a lost reply cannot lock the camera out; asking again from the old one simply issues another. The Android
  camera saves the new credential before using it and rebuilds its signaling connection when no viewer is
  connected. Each use is recorded (`last_used_at`, at most every ten minutes). Not yet exercised on a real
  phone across a month.
- **V70, snapshots.** Android live-view snapshots stay in `Pictures/Beacon`, because saving is a deliberate
  tap. The confirmation now says other apps and photo backup can see the file.
- **V71, video size.** The camera screen's options menu offers Standard (640 × 480) and HD (1280 × 720),
  default Standard. It applies when the camera next starts. The camera library picks the closest size the
  phone supports. HD needs a battery and heat check on real phones.
