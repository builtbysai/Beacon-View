# ADR 0104: Local clip bookmarks

Status: Accepted for the owner-approved convenience completion, October 9, 2026.

The clips library stores only bookmarked recording identifiers in local storage,
scoped by account and household. Names, thumbnails, media, keys, and tokens are
never stored by bookmarks. Storage is bounded and malformed/blocked storage does
not prevent library use. Storage failures fall back to the current visit with a
visible notice. There is no cloud sync or backend migration.

Bookmarked-only filtering intersects the authorized, paginated clip list. Saved
IDs never initiate metadata or playback requests. Existing playback authorization,
encryption, deletion, and retention remain authoritative. Deleted or inaccessible
clips cannot be resurrected by a bookmark; retention does not preserve them.
Successful deletion from this library removes its bookmark. Stale IDs from remote
deletion may remain locally because absence from one page cannot prove deletion.

The app remounts the library for account, household, role, or membership revision
changes, releasing playback resources and clearing loaded records. Five hundred
bookmarks can be saved per scope; storage size and identifier length are bounded.
