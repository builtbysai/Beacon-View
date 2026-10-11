# ADR 0109: Owner decisions of October 10, 2026

- Status: Accepted (answers given by the owner in the session of 2026-10-10)
- Source: `docs/full-audit-2026-10-09.md`

## V32: who a new viewer sees

The owner chooses when inviting. A viewer invitation must say "all cameras" or list
specific cameras; the server refuses one that does not (migration 0038 adds
`camera_scope` and `camera_public_ids`; invitations already pending stay "all"). The web and
Android invite forms start with nothing selected. Guests and admins are unchanged.

## V41: resuming a camera paused at the phone

No change. Anyone whose grant includes pause can resume. The owner controls this by
editing each viewer's and guest's pause permission, which already exists (member grants and
guest links). A local pause is therefore a convenience for people at the phone, not a lock
against household members the owner allowed to pause.

## V2: desktop update trust

Add an Ed25519 signature check to the desktop update manifest now, using a key only the
owner holds (see ADR 0110), and buy a Windows code-signing certificate later. Until then
Windows still shows an unknown-publisher prompt.

## V6 and V7: recording keys

Keep the design: clips are encrypted before they reach Drive, and the server holds the
wrapped keys so it can play clips back. The product says so plainly and never claims
end-to-end encryption (Trust page, clips page, privacy policy, security overview). The
wrapped key is now bound to its recording and to clip or thumbnail, a previous key can be
configured for rotation (`RECORDING_ENCRYPTION_KEY_PREVIOUS`), and a daily job moves every
stored key to the current key and binding. True end-to-end encryption would be a separate
milestone (device key exchange, recovery, no server-side share links).
