# ADR 0098: Saved camera groups and wall layouts

Status: Accepted — owner approved continuing with the proposed next convenience
milestone on October 9, 2026.

## Decision

A named wall layout combines a group of up to nine device IDs, their order, and
an automatic/one/two/three-column preference. Web and desktop users can create,
edit, load and delete up to twenty layouts. Names distinguish layouts; existing
names cannot be accidentally overwritten. Selection and ordering use labeled
checkboxes and Move up/down buttons instead of requiring drag gestures.

Store these preferences in localStorage, scoped to account and household. Store
device IDs rather than camera source IDs so lens changes follow the current
active source. Resolve all IDs against the current authorized camera inventory;
preferences never grant access. Do not store camera names, media or credentials.
Unavailable cameras are omitted and explained. Existing stream limits, Talk
permissions, privacy shutdown and Data saver remain in force. Changing layouts
stops Announce; changing account/household remounts the wall.

The wall opens with All cameras, requiring an explicit selection of a saved
group rather than restoring additional streams on startup. Corrupt storage is
ignored. A failed write keeps the layout usable in memory with an explicit
page-only warning. Users can delete layouts; deletion does not delete cameras.

## Consequences and limits

No dependency, backend migration or new capture/upload path is added. Layouts
are private browser-profile preferences, not household-shared objects. They do
not sync across devices or browser profiles; desktop's storage is separate from
Chrome. Native Android groups, cloud synchronization, standalone group management
and tray shortcuts for saved groups require later scope. Layout names are local
user-supplied labels and should not contain sensitive information on shared
computers. Offline cameras do not reserve an empty tile; available cameras retain
their relative saved order.

Validation covers authorization-inventory changes, active lens changes, account/
household isolation, group order and selection, persistence, corruption, duplicate
names, nine-camera bounds, cancellation and storage failure. Real Electron and
hardware streaming acceptance remain part of the existing device matrix.
