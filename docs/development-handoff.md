# Beacon SecureView development handoff

## September 27, 2026 — Household per-camera grant editing completed, plus a missing confirmation step found and fixed

Continued the screen-by-screen sweep onto the last explicitly-deferred
household/sharing gap: per-camera grant editing for viewer/guest members.
Comparing against the PWA's `HouseholdSharingSettings.tsx` (`ManageMemberDialog`)
found the feature was previously unimplemented on Android at all -- membership
(invite/join/member list/revoke) existed, but there was no way to control
which cameras a viewer or guest could see, let alone Listen/Talk/Flip/Pause on.

**New API surface** (`BeaconApi.kt`): a `CameraGrant` data class
(`cameraId`/`cameraName`/`canListen`/`canTalk`/`canFlip`/`canPause`),
`HouseholdMember.grants: List<CameraGrant>` (the backend's `GET
/api/household/sharing` already returned this per member -- Android was
discarding it), `updateHouseholdMemberGrants()` (`PUT
/api/household/members/:id/grants`, a full-replace contract matching the
backend exactly -- send every camera the member should still have access to,
omitted ones lose it), and `permanentlyRemoveHouseholdMember()` (`DELETE
/api/household/members/:id/permanently`, only valid once a member is already
revoked).

**New UI** (`HouseholdSharingPanel.kt`): `BeaconManageMemberDialog` mirrors
the PWA's `ManageMemberDialog` almost exactly -- per-camera View/Listen/Talk/
Flip/Pause checkboxes (unchecking View clears the other four; the PWA also
remembers a camera's last sub-permissions across an uncheck/recheck within
the same dialog session and offers a search box past 8 cameras, both skipped
as minor polish, not correctness), and a danger footer that changes with the
member's status: "Remove access" (soft-revoke) while active, "Delete from
list" (hard delete) once already revoked -- matching the PWA's two-stage
`onRevoke`/`onRemove` design exactly rather than the single always-on action
an earlier draft of this dialog had.

**Real gap found and fixed while wiring this up, not part of the original
plan**: the existing admin-row "Remove" button in the People & access list
called `removeHouseholdMember` directly with **no confirmation step at all**,
unlike the PWA's `ConfirmDialog` ("Remove {email}? They immediately lose
access to every camera in this household."). A stray tap would have
silently revoked someone's access. Added a shared `BeaconConfirmRevokeDialog`
used both by the admin row and by `BeaconManageMemberDialog`'s own "Remove
access" action, plus a matching confirm step ("Delete {email} from the list?
This removes their record entirely rather than just revoking access.")
before the new permanent-delete action -- copy matches the PWA's
`ConfirmDialog` instances verbatim. The member row's subtitle now also shows
"· Access removed" for a revoked-but-not-yet-deleted member instead of a
stale grant count, matching `HouseholdSharingSettings.tsx` exactly.

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`) passes, one transient Windows Gradle-daemon OOM on
`mergeDexRelease` mid-session (same known class of flakiness documented
elsewhere in this file; killing the daemon and retrying with a larger
`-Xmx` succeeded cleanly). Physically confirmed end-to-end on a two-emulator
setup, not just compiled: registered a genuine second test account
(`beacon.review.viewer@example.test`), invited and accepted it into the
household as a viewer, opened `BeaconManageMemberDialog` and toggled Listen
on for one camera, saved, and independently confirmed via the database that
`camera_grants.can_listen` actually flipped to `true`. Then exercised the
full two-stage removal: "Remove access" (with its confirm dialog) soft-
revoked the member (verified `household_members.status = 'revoked'`), and
reopening the dialog correctly showed "Delete from list" instead of "Remove
access"; confirming that deleted the member's row entirely (verified zero
rows remain for that member id).

## September 27, 2026 — Found and closed a real gap in the primary pairing flow: Android could never pair a _different_ device

Continuing the screen-by-screen sweep onto "Add camera" surfaced something
more significant than a styling gap: comparing against the PWA's
`AddCameraPage.tsx` and `PairingDialog.tsx` showed that **Android's monitor
UI had no way to pair a separate spare Android device at all.** Tapping "Add
camera" always called `pairSignedInCamera`, which creates a pairing code and
immediately redeems it _on the same device_ -- a clever one-step shortcut for
the "use the phone I'm holding right now" case, but it's the PWA's _other_
option ("Use this device" / browser camera mode), not its recommended
primary path. The PWA's actual "Add a device" page presents a real choice:
"Pair another device" (recommended -- shows a QR code and one-time code for
a _different_ phone to scan) versus "Use this device" (self-pair). Android
had silently collapsed onto the second option always, meaning the app's own
core stated purpose -- monitor from one phone, use a spare phone as the
camera -- had no supported path through the Android client itself. Every
two-device test this session worked by signing into the _same_ account
independently on each emulator and self-pairing each one, not by using a
real monitor-generates-code-for-a-separate-device flow, because that flow
did not exist.

**Root cause was a missing consumer, not a missing endpoint**:
`api.createPairingCode(sessionToken)` already existed and already worked --
it was just never called from anywhere except inside the self-pairing
shortcut, never exposed as its own action the user could trigger to get a
code for a _different_ device.

**Added**: a `BeaconAddCameraChoiceDialog` (mirrors `AddCameraPage.tsx`'s two
cards exactly, including copy) shown from both of "Add camera"'s entry
points (Cameras catalog, Home's zero-camera state -- previously both jumped
straight to self-pairing), and a `BeaconPairAnotherDeviceDialog` (mirrors
`PairingDialog.tsx`'s non-reconnect case) that generates a code on open and
shows it as both a **scannable QR code** and plain text, plus a copyable
setup link. The QR needed a new dependency -- `com.google.zxing:core` --
since the `play-services-code-scanner` library already in this app only
_reads_ barcodes, it has no encoder. zxing is small, pure-Java, dependency-free,
and one of the most widely used QR libraries in the Android ecosystem, so
this isn't scope creep, it's the standard tool for a real, previously-missing
piece of the product's core flow.

Deliberately not ported: the PWA's live auto-completion detection (a
household websocket event flips the dialog to "Camera connected" and
auto-navigates) -- Android's monitor session has no live household-event
feed wired into this dialog, so the user dismisses manually once the other
device is paired, matching the simpler pattern already established for the
Reconnect dialog in the previous entry.

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`) passes -- one transient Windows Gradle-daemon lock/OOM
hit mid-session (a stuck daemon process from an earlier run holding the
file-hash cache lock; killing it and retrying succeeded cleanly, matching
the known class of Windows-host flakiness already documented in this file).
Physically confirmed end-to-end on `emulator-5554`: tapping "Add camera"
now shows the real two-option chooser, and choosing "Pair another device"
generates and displays a genuine scannable QR code plus a working one-time
code (`JLY8YURF3R` in the test run) from the real backend.

## September 27, 2026 — Camera Device Settings screen fully rebuilt; a whole missing Device API surface added

Continued the screen-by-screen sweep onto the settings screen reached from
a camera's gear icon (Cameras catalog, Live viewer). Comparing against the
PWA's `CameraSettings.tsx` found the same "invented structure" pattern as
Home/Cameras/Settings, but bigger: Android's version was built entirely
from `MonitorCamera` (`/api/cameras`), which is camera-source-centric and
carries none of the device-level fields the PWA's screen actually shows.
There was no shortcut available here -- matching the web required a real
new API surface, not just new Compose code, so this is the "reorganize the
backend layer where it doesn't support the goal" case explicitly discussed
before starting.

**New Device API layer** (`BeaconApi.kt`): a `Device` data class matching
`GET /api/devices`'s response exactly (connection state, last-seen,
battery, health-reported-at, software version, revoked/canRemove,
capabilities -- none of which existed on Android in any form), plus
`devices()`, `renameDevice()`/`removeDevice()` (`PATCH`/`DELETE
/api/devices/:id`), `renameCameraSource()`/`removeCameraSource()`
(`PATCH`/`DELETE /api/cameras/:id`), and `reconnectDevicePairingCode()`
(`POST /api/devices/:id/pairing-code` -- a device-_targeted_ reissue that
keeps the existing device record and its settings, distinct from the
generic `createPairingCode()` Android already had for pairing a brand new
device). `devices()` is now fetched alongside `cameras()` in the existing
poll loop.

**New presentation layer** (`DeviceSettingsPresentation.kt`, 12 unit
tests): verbatim ports of the PWA's `device-guidance.ts` (`deviceGuidance`,
covering revoked/disabled/privacy/offline/no-camera/healthy in that
precedence), `device-presentation.ts` (`relativeLastSeen`,
`capabilitySummary`), and `naming.ts` (`deviceKindLabel`), plus a
`deviceAttentionNotice` function that reproduces `CameraSettings.tsx`'s
exact `(needsReconnect || warning || guidance.attention)` gate and its
title/summary precedence (reconnect-needed beats a low-battery warning
beats general guidance).

**Rebuilt `MonitorDeviceSettings`** (`MonitorComponents.kt`) to match the
PWA's actual sections instead of the old invented "DEVICE STATUS" card: a
renameable title with a device-kind eyebrow, a three-column health summary
(Connection/Last seen/Viewers), a conditional attention notice with a
working Reconnect action and an expandable Troubleshoot/Readiness-tips
disclosure, per-camera-source rows with working rename/remove and a "View
live" button, a Privacy toggle switch (was a button), a full Device
information list (was entirely missing: device kind, power, health-updated,
capabilities, software version, access state), and a Remove-camera danger
section (was entirely missing -- there was previously no way to remove a
paired camera from its own settings screen at all). The composable owns
its own rename/remove/reconnect network calls end to end, matching this
session's other Settings-adjacent panels.

Scoped out, matching the precedent already set for Household grants:
"Leave this camera" (the guest/viewer self-removal path) wasn't ported --
it needs a second real non-owner account to exercise meaningfully, same
reasoning as the deferred per-camera grants work.

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`) passes. Physically confirmed end-to-end on `emulator-5554`
against a real revoked/offline device left over from earlier testing: the
health summary showed real values (Access revoked / 3 hr ago / 0 viewers),
the attention notice correctly read "This camera needs to reconnect" with
the exact PWA copy, both camera sources listed with working rename/delete
icons, Device information showed real battery/capabilities/software-version
data, and tapping Reconnect actually created a working one-time pairing
code from the backend (`GKUHA2W4BS` in the test run) -- a capability that
did not exist on Android in any form before this change.

## September 27, 2026 — Clips library gets the same search/filter/day-grouping treatment as Activity

Followed the Activity feed rebuild with its sibling: the PWA's
`RecordingLibrary.tsx` has the same search box, camera and time-range filter
selects, a result count, and day-grouping as the Activity feed, layered on
top of the playback/share/delete functionality Android already had. Unlike
Activity, this needed **no API changes** -- `/api/recordings` has no
server-side filter params at all, so the PWA itself filters/sorts whatever
page it has already loaded client-side rather than re-querying, and Android
now does the same (`filteredRecordings`/`groupRecordingsByDay` in
`RecordingLibrary.kt`, reusing the Activity feed's `activityDayLabel`
day-grouping helper rather than duplicating it).

Kept `AndroidRecordingLibrary`'s existing hoisted-state architecture
(recordings/playback/delete/share state still lives in `MonitorHome`,
already working and tested) rather than converting it to a fully
self-contained composable like `BeaconActivityFeed` -- the new search/
camera-filter/time-filter state is pure presentation, doesn't drive any
network call the way Activity's filters do, and adding it as local state
inside the existing composable was the smaller, lower-risk change that
still gets to the same result. Added an "N clips" result count and a
"No matching clips" empty state distinct from the existing "No recorded
clips yet." zero-clips state, matching the PWA's own two-empty-states
distinction.

9 new unit tests (`RecordingLibraryTest.kt`) cover camera/time/search
filtering and day-grouping. Validated: full local gate (`testDebugUnitTest
lintDebug assembleDebug assembleRelease`) passes. Physically confirmed the
zero-clips state renders correctly with the search/filter UI correctly
hidden (matching the PWA's own `cameras.length > 0` guard around its
controls); the non-empty search/filter/grouping UI itself wasn't
re-verified live against a real clip in this pass since none exists on the
current test account, but it reuses the exact same, already-visually-verified
components as the Activity feed (search field, filter dropdowns, day
headers) plus its own dedicated unit tests.

## September 27, 2026 — Activity feed fully rebuilt to match the PWA's "v3" feed, not just the header

The previous entry flagged the PWA's real Activity feed (search, camera/time
filters, kind chips with live counts, sort, day-grouping, a "How detection
works" explainer, a detail drawer) as a large gap to defer. The owner's
follow-up instruction was explicit: keep going screen by screen, don't take
shortcuts, and reorganize the Android API layer if that's what matching the
web actually requires. Built it for real instead of deferring it.

**Backend/API layer changes** (`BeaconApi.kt`) -- this genuinely needed
reorganizing, not just a UI pass:

- `MotionEvent` gained `recordingId`/`recordingStatus`, which the backend's
  `/api/motion-events` response already included but Android was silently
  discarding -- needed for the "View clip" tag on a motion row and the
  detail dialog's Clip fact.
- `motionEvents()` changed from a fixed `?limit=50` fetch returning a bare
  list to a properly paginated call accepting `cameraId`/`since`/`cursor`/
  `limit` and returning a `MotionEventPage(events, nextCursor)`, matching
  `parseMotionHistoryQuery`'s actual contract in `motion-history.ts`.
- Added `motionEventById()`, `clearMotionEvents()` (`DELETE /api/motion-events`),
  and a new `householdActivity()` call against `/api/activity` --
  the household-wide audit feed the PWA merges with motion events on this
  page. This is a _different_ endpoint from `/api/access-history` (already
  wired as `accessHistory()`/`AccessEvent` for Settings > Security's
  narrower "signed-in access" log) -- conflating the two would have been
  wrong. `/api/activity` is owner/admin-only server-side, so the new
  `HouseholdActivityEvent` fetch is gated the same way client-side.
- Fixed a real, separate bug found while reading `recording-status.ts` for
  the clip tag: Android's `recordingStatusLabel` didn't match the PWA's
  labels at all ("Preparing recording" vs "Recording starting", etc.) and
  had **no case for `"available"`** -- a ready clip fell through to a
  generic "Unavailable" label. Rewrote it to match `recordingStatusLabels`
  exactly and added `recordingStatusTone` (link/pending/failed), shared
  between the new Activity clip tag and the existing Clips library status
  pill so the two views never describe the same recording state two
  different ways again.

**New presentation layer** (`ActivityFeedPresentation.kt`, unit-tested):
a sealed `ActivityFeedEvent` (`MotionActivityEvent` | `HouseholdActivityFeedEvent`)
mirrors the PWA's `MotionEvent | HouseholdEvent` discriminated union;
`activityLabel`/`activityDeviceName`/`activitySourceName` port the exact
`activityLabels` lookup table and rename special-cases from
`MotionEventList.tsx`; `filteredActivityEvents` ports the camera/kind/search
filter and all four sort orders; `groupActivityByDay` ports the
Today/Yesterday/full-date grouping. 11 new unit tests.

**New UI** (`ActivityFeedUi.kt`, `BeaconActivityFeed`): a self-contained
composable (owns its own network/filter state, matching this session's other
Settings-panel composables) rendering the intro + "How detection works"
disclosure, a search field, camera and time-range filter menus, kind chips
with live counts, a result count with a sort menu, day-grouped rows (each
showing label, time, an optional clip tag, and device/source/confidence),
Load more (across both paginated sources independently), Clear motion
history (owner/admin only), and a detail dialog with the event's full facts
and contextual actions (View clip / Open device). Wired into
`MonitorPage.Events`, replacing the old bare list.

Deliberately not ported (real, separate follow-ups, not this pass): the
PWA's client-side re-filter by time range on top of the server's own
`since` query (Android relies on the server query alone); cross-navigation
polish (`onViewClip` switches to the Clips tab but doesn't scroll to/
highlight the specific clip; a `focusMotionEventId` deep link from Clips
back into Activity was not added either).

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`, 90 unit tests) passes. Physically confirmed on
`emulator-5556` against real household-activity data generated earlier this
session (pairing, camera-source-added, live-view-started, device-disconnected):
day grouping under "Today", kind chips showing live counts (All 4 / Motion 0
/ Household 4), the camera and time-range dropdown menus opening and
applying, and tapping a row opening the detail dialog with the correct
facts and a working "Back to activity" action.

## September 27, 2026 — Settings and Activity/Clips headers de-slopped; Login screen audited clean; two large remaining gaps identified

The owner's framing this round was the reverse of earlier passes: not "Android
looks different," but "Android has leftover text and invented sections the
web no longer has." Audited screen by screen, reading each PWA source fresh
rather than trusting earlier assumptions.

**Login/Sign-in (`MonitorAuthScreen.kt`) — audited, no slop found.** Compared
line-by-line against `AuthScreen.tsx`'s current login/register/forgot-password
views: copy, field order, and structure already match closely (this was
rebuilt correctly in an earlier session). One real, deferred gap: Android has
no `googleAvailable` capability check, so it always renders a clickable
"Continue with Google" button even when a backend has Google sign-in
disabled, where the PWA shows a disabled "Google sign-in unavailable" state.
Fixing this needs a new capabilities fetch at startup, not a text edit --
left as an open item rather than rushed.

**Settings (`MonitorUi.kt`) — the actual source of the "slop" complaint.**
Found and removed, all with no PWA counterpart at all:

- The page-level header (`eyebrow = "Beacon / account"` + a supporting
  sentence) -- the PWA's Settings page has no page-level intro, only each
  section's own one-line `SectionHead`. Replaced with a bare "Settings"
  title, same fix already applied to Cameras.
- A whole invented **"This device"** section (a "Camera mode" card
  duplicating the "Add camera" action that already exists on the Cameras
  page and Home) -- deleted outright, including the now-unused `cameraPaired`
  parameter threaded through `MonitorHome`/`MainActivity.kt`.
- A duplicate inline **"Sign out"** button at the bottom of the Settings
  body -- the drawer's account menu already has an identical one (confirmed
  by comparing `onLogout` wiring), and the PWA's `SettingsPage.tsx` has no
  sign-out control in the page body at all, only in its sidebar account menu.
- Explanatory paragraphs invented beyond the PWA's trimmed copy: a privacy
  reassurance line under Notifications ("Motion and availability alerts
  never include camera names, images, or recordings.") and one under Motion
  history ("Beacon stores motion time, camera name, and intensity—not
  recordings, images, or audio.") -- neither exists in `NotificationSettings.tsx`
  or `MotionRetentionSettings.tsx`.

Also fixed two real accuracy/ordering issues found while comparing against
`SettingsPage.tsx`: **Data & storage and Security were in the wrong order**
(Android had Security first; the PWA has Data & storage first), and the
Delete-account description had drifted to claim a narrower scope than it
actually has ("Permanently remove your Beacon household and its data" ->
corrected to match the PWA's actual "Permanently removes your Beacon
account, data and access."). Rebuilt the Privacy section, which had shrunk
to two generic trust-line bullets, to match the PWA's real structure: an
intro, three privacy-fact rows (Motion history / Security activity / Cloud
storage), and a "Trust & privacy -> View details" row linking out (new
`BeaconPrivacyFact` composable in `BeaconDesign.kt`).

**Activity and Clips headers de-slopped, but a much bigger gap surfaced
underneath.** Both `MonitorPage.Events`'s Activity view and
`RecordingLibrary.kt`'s Clips view had the same invented eyebrow+title
+supporting-text header pattern; replaced both with the PWA's actual single
intro paragraph (`MotionEventList.tsx` / `RecordingLibrary.tsx`). While
reading those PWA components to get the real copy, found that **the PWA's
current Activity and Clips screens are a full "v3" feed** -- search box,
camera and time-range filters, kind-filter chips with live counts, sort
control, day-grouped headers, an inline "How detection works" explainer, and
a detail drawer -- none of which exists on Android today (it's a bare
list with no search/filter/sort at all). This is the opposite direction of
the "slop" complaint: a real, large feature gap, not extra text. Given the
size (this is comparable in scope to the Home/Cameras/live-viewer rebuilds
combined), it's flagged here as its own future milestone rather than
attempted under this same pass -- attempting it hastily would produce a
worse result than the deliberate, verified approach used for the other
screens.

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`) passes. Physically confirmed on `emulator-5556`: Settings
now renders Household -> Notifications -> People & access -> Data & storage
-> Security -> Account -> Privacy in that order, with no page-level header,
no "This device" section, no duplicate Sign-out, and the rebuilt Privacy
section (intro, three facts, Trust & privacy link) all matching; Activity's
new intro paragraph and empty state confirmed too.

## September 27, 2026 — Live viewer ported to match the PWA; a likely, unconfirmed Android WebRTC connectivity gap found

Continued the CSS-driven port onto the live camera viewer
(`AndroidLiveView` in `NativeLiveView.kt`), reading the PWA's
`LiveVideo.tsx`/`.css` and `live-video-presentation.ts` directly. Two classes
of gap, same pattern as Home and Cameras:

**Invented UI removed** (no PWA counterpart): a favorite-star toggle in the
header, and previous/next arrows that paged through _every_ camera in the
household. The PWA's live view only ever switches between one device's own
sibling sources (`CameraFlipButton`, already matched by Android's existing
`onFlip`) -- it has no concept of paging through unrelated cameras from
inside the live view, and no way to (un)favorite a camera from there either
(favorites are only edited from Home's `FavoritesEditor`). Deleted both
outright, including the now-dead `movedCameraId`-style plumbing they needed
(`favoriteCameraIds`/`onFavorite` wiring in `MonitorUi.kt`), rather than
leaving them dormant.

**A real gap closed**: the PWA's header always shows a "Camera settings" gear
button linking to device settings; Android's live view had no such button at
all -- `onDevice` was never wired into `AndroidLiveView`. Added it, replacing
the removed favorite-star button's position, wired to the same
`selectedSettingsDeviceId` navigation the Cameras catalog already uses.

**A real correctness bug fixed while porting the overlay text**: the center
"connecting" overlay only ever showed one of two titles ("Connecting to
camera" / "Reconnecting to camera") based on a single `== Connecting` check,
so a genuinely `Offline` or `Failed` camera showed the misleading
"Reconnecting to camera" title above its own, differently-worded detail line
just below it. Replaced with a single `liveOverlay(state, privacyMode,
reconnectAttempt)` function in `MonitorPresentation.kt` that mirrors the
PWA's `live-video-presentation.ts` `liveOverlay` exactly: one consistent
title+detail pair per state, with privacy-mode checked first (matching the
PWA's own precedence) so a camera whose privacy just got turned on while
being watched now correctly shows "Privacy is on" instead of whatever stale
connection-state text it last had. `viewerStatusText` (the old, now-fully-
redundant helper) was deleted along with its test.

**Added, using only data Android already had**: the PWA's "Stream details" /
"N other viewers" disclosure button and the viewer-roster panel it opens
("You" + a placeholder row per other viewer, "Viewer names stay private in
this live view."), replacing the old always-visible prev/next row. The PWA's
same panel also shows live WebRTC quality metrics (path/fps/bitrate/rtt/
jitter/loss) pulled from `RTCPeerConnection.getStats()` -- that part was
**not** ported, since Android's `AndroidViewerSession` doesn't currently
expose any stats plumbing to the UI; adding it is a native-layer task, not a
UI port, and is left as an open, documented gap. **Talk (two-way audio to
the camera) was also not ported** for the same reason -- it needs native
microphone capture and an outbound WebRTC audio track wired through
`AndroidViewerSession`/`CameraSignalingClient`, which doesn't exist on
Android today. Both are real, product-relevant gaps, just not ones a
Compose-layer port can close; they belong on their own milestone.

**An important, unresolved finding surfaced during on-device verification,
not fully root-caused**: watching the live feed between the two emulators
(`Beacon_Phone` as monitor, `Beacon_Camera` as the paired camera, same
dev-backend setup as the Cameras catalog verification) connected successfully
exactly once, then failed on every subsequent attempt with "Unable to
connect" -- immediately, without ever reaching Connected first. The camera
side stayed healthy throughout (steady green connected indicator, capture
never interrupted), so the failure is on the viewer's negotiation path.
Reading `apps/backend/src/config.ts` and `signaling-route.ts` shows the
signaling server hands out **role-based** ICE servers with no
platform-aware case for a native Android viewer: `role === 'viewer'` always
gets `VIEWER_STUN_URL`/`VIEWER_TURN_URL` (default `127.0.0.1:3478`, correct
for a browser on the same host as the backend during local dev), while
`role === 'device'` gets `DEVICE_STUN_URL`/`DEVICE_TURN_URL` (default
`10.0.2.2:3478`, correct for the _camera_ app on an emulator). An Android
**monitor** app is a `viewer`, so it's always issued the browser-oriented
`127.0.0.1` address -- which, from inside an emulator's own network
namespace, refers to the emulator itself, not the host, and would be no
better on a physical device (`10.0.2.2` has no meaning outside an emulator,
and `adb reverse` only forwards TCP, not the UDP that STUN/TURN prefers).
This is a plausible, code-supported explanation for a local-dev-only
connectivity gap that would affect _every_ native Android monitor trying to
watch a live stream against a local backend -- but it was not confirmed with
packet-level or server-log evidence in this session (no access to the
running dev backend's logs), and doesn't explain why the very first attempt
connected. Flagging this prominently rather than asserting it as a confirmed
fix: this needs either a platform-aware third ICE-server case (native mobile
viewer vs. browser viewer) or further diagnosis with real logs before
anyone spends time debugging what looks like an app bug but might be a
local-dev-only address mismatch. Does not affect production, where a real
internet-routable STUN/TURN address is reachable from anywhere.

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`) passes, including new unit tests for `liveOverlay`.
Physically confirmed on-device: header (settings gear, no favorite star),
bottom control row (Listen/Flip/Record/Fullscreen, no prev/next), the
"Stream details" → "N other viewer(s)" toggle wording change, and the
`Failed`-state overlay text ("Unable to connect" / "Beacon will keep
trying.") all rendered correctly. The `Connected` state with an actual
decoded video frame was seen once but not reliably reproducible in this
two-emulator setup, for the reason above.

## September 27, 2026 — Cameras catalog ported to match the PWA; physical Pixel swapped for two emulators

Continued the CSS-driven port from Home onto the Cameras catalog
(`MonitorPage.Cameras` in `MonitorUi.kt`), following the same methodology:
read the PWA's actual `CameraBrowser.tsx`/`.css` and `App.tsx` topbar code
rather than approximating. Found the same class of gap as Home: Android's
Cameras page had **invented UI with no PWA counterpart** -- a page header
with an eyebrow and supporting text (`BeaconPageHeader`), and a toolbar with
"Refresh", "Favorites"/"All", and "Reorder" buttons (the last enabling drag-
style "Earlier"/"Later" arrows on every camera card). None of this exists on
the web: the PWA's Cameras page is just an `h1` ("Cameras") with a role-gated
"Add camera" button top-right, and the actual `CameraBrowser` component has a
search box, four filter pills with live counts (All/Ready to view/Privacy
on/Need attention), and a results-count line -- none of which Android had at
all.

Rewrote the page to match: dropped the eyebrow/supporting-text header and the
Refresh/Favorites/Reorder toolbar (the "Reorder" feature was Android-only and
had no web equivalent, so `movedCameraId` in `CameraOrderStore.kt` and the
reordering params on `MonitorCameraGrid`/`MonitorCameraCard` were deleted
outright rather than left dead); added a search field, four `FilterChip`
pills with counts, and a results message, all driven by new pure functions in
`MonitorPresentation.kt` (`CameraCatalogFilter`, `cameraCatalogMatchesFilter`,
`cameraCatalogSearchMatches`, `cameraCatalogVisible`,
`cameraCatalogResultsMessage`) that mirror `CameraBrowser.tsx`'s `matches`/
`resultsMessage` logic exactly, including the PWA's curly-quoted search
message. Empty states now match the web too: plain "No cameras yet." text
with no button when the account has zero cameras (previously Android showed
an invented "Set up this device" panel here), and a "No matching cameras" /
"Clear filters" card when a search or filter yields nothing, matching the
PWA's `camera-no-results` block.

**One real bug caught during physical verification, not code review**: the
first version put the four filter pills in a plain `Row`, which doesn't wrap
or scroll -- on a phone-width screen the fourth pill ("Need attention") was
silently clipped off the right edge of the screen with no visual indication
anything was missing. Fixed by wrapping the pills in
`Modifier.horizontalScroll(rememberScrollState())`, matching the PWA's own
`overflow-x: auto` behavior for `.filter-pills` at mobile widths. This is
exactly the kind of thing screenshot comparison catches and code review
doesn't -- the Kotlin looked correct and compiled fine.

Known, documented gap not addressed this pass: the web's Cameras page also
shows a `PendingDeviceRow` for a paired device that hasn't reported a camera
yet (name, status, "Settings" link) -- Android has no concept of a paired-
but-camera-less device separate from `MonitorCamera`, so this wasn't
portable without a data-model change. Left as an open item.

Also swapped the physical Pixel (now reserved by the owner for other use)
for two hand-built AVDs, since neither `avdmanager` nor `sdkmanager` is
installed on this machine (`cmdline-tools` component missing) -- `Beacon_Phone`
(monitor viewer) and `Beacon_Camera` (paired as a live camera under the same
test account) were created by hand-writing `~/.android/avd/<name>.ini` and
`config.ini` against the already-installed
`system-images/android-36/google_apis_playstore/x86_64` image. **Pitfall hit
twice**: writing `config.ini` through a bash heredoc with escaped
double-backslashes for the Windows SDK path corrupted the file -- a trailing
single backslash at end-of-line before a newline is a line-continuation in
an unquoted heredoc, so `image.sysdir.1=...x86_64\` silently merged with the
next line (`runtime.network.latency=none`) into one bad key, and the emulator
failed at startup with `Cannot find AVD system path`. Fixed by writing the
file with the Write/Edit tools instead of a bash heredoc for any file
containing literal Windows path backslashes. With both emulators running
(one signed in as camera, one as monitor, `adb reverse tcp:3000 tcp:3000` on
each), the full non-empty Cameras catalog -- badge, search, filter counts,
scrollable pills, results text, no-match state -- was visually confirmed
end-to-end against a real paired camera, not just the zero-camera state.

## September 27, 2026 — Android Home screen was structurally wrong, not just styled differently

The owner asked why Android still "looks like slop" next to the PWA despite
the Settings work above, and to research a better porting approach. Answer
after investigation: eyeballing PWA screenshots and approximating Compose
values (what this session had been doing) isn't reliable enough --
**the web itself doesn't put everything on the shared 4-step radius/spacing
token scale**; individual components have their own tuned one-off CSS values
(confirmed by grepping every web `*.css` file for `border-radius` outside
`var(--radius-*)` -- dozens of one-off values like 14px, 18px, 9px scattered
across component stylesheets). So "port every screen onto BeaconRadii/
BeaconSpacing" was the wrong mental model. The right one, agreed with the
owner: keep the native Compose UI (a WebView wrapper was considered and
rejected -- it would discard a real, tested native Settings/Clips/household
implementation just to fix an execution problem, and camera mode has to stay
native regardless), and port each remaining screen by reading its actual web
CSS file and matching those exact values, the same way ADR 0080 already did
for the shared base tokens.

Applied that to Home first, and found something bigger than a styling gap:
**Android's Home screen was structurally wrong**, not just visually
approximate. `MonitorPage.Home` always rendered a solid dark hero panel
("BeaconHeroPanel") with an Android-invented headline
("Set up your first camera" / "A camera needs your attention" / "Your home
is within reach") that has no counterpart anywhere in the PWA. Reading
`App.tsx` directly: the PWA's zero-camera state is `.dash-empty` -- a plain
card with a **dashed** border (`border: 1px dashed var(--border-default)`),
not a solid dark background, with real copy ("Add your first device" for an
owner/admin, "No cameras shared with you yet" for a viewer/guest) and a
"+ Add device" button. The non-empty state is even further off: the PWA
renders a plain `h2` greeting (time-of-day: Good morning/afternoon/evening)
and a small secondary-colored subtitle ("N of M cameras are ready to view."),
_not_ a card at all, with a real attention banner (only shown when a camera
actually needs attention) and a genuine Favorites grid -- none of which
Android had; it always showed the same hero regardless of state, plus two
stat tiles ("Ready to view"/"Watching now") that don't exist on the web at
all.

Rewrote `MonitorPage.Home` in `MonitorUi.kt` to match the PWA's actual
structure: `Modifier.beaconDashedBorder` (new, in `BeaconDesign.kt` -- plain
`Modifier.border` can't draw dashed strokes, so this draws one manually) for
the two empty-state cards (zero cameras, zero favorites), and new
`homeGreeting`/`homeSubtitle`/`homeAttentionCameras`/`homeAttentionTitle`/
`homeAttentionDescription`/`homeFavoriteCameras` helpers in
`MonitorPresentation.kt` that mirror the PWA's own `App.tsx` computations
line-for-line (same ready-count phrasing, same privacy-mention precedence,
same first-four-cameras favorites fallback). One deliberate, documented
simplification: the PWA's attention-banner text distinguishes "needs
pairing" from "offline" and lists every camera name by grammar for 2-4
cameras; Android has no equivalent pairing-state signal to tell those apart
yet, so it covers the single- and multi-camera cases with simpler, still-
accurate phrasing rather than faking a distinction it can't verify. The
"Edit"/"Choose favorites" buttons navigate to the Cameras tab rather than
opening a dedicated favorites-editor dialog, since no such dialog exists on
Android yet (the web's `FavoritesEditor.tsx` has no native counterpart) --
noted as an open gap rather than building a new dialog under time pressure.

Validated: full local gate (`testDebugUnitTest lintDebug assembleDebug
assembleRelease`) passes, including new unit tests for the `home*` helpers
matching the PWA's exact copy/logic. Physically confirmed on the Pixel
(landscape, ≥600dp so the wide-layout sidebar also happened to be exercised):
the zero-camera dashed-border card renders correctly and matches the PWA's
`dash-empty` card side-by-side (both open at once, compared directly). The
non-empty state (greeting, subtitle, attention banner, Favorites grid) is
implemented and unit-tested but **not yet physically confirmed** -- this
test account has no paired camera, so the only state actually exercised on
a real device is the zero-camera one.

**This is one screen.** The same structural gap (Android inventing UI that
doesn't exist on the web, rather than being a literal styling approximation
of something that does) likely exists on other screens not yet given this
treatment -- Cameras catalog, the live viewer, and the auth screens are the
next candidates, roughly in that order of user-facing visibility.

## September 27, 2026 — real Android bug found and fixed: bodyless DELETE requests were broken app-wide

While verifying the new Signed-in devices Revoke button against real hardware
(physical Pixel and a Samsung tablet, both connected via adb, backend
tunneled with `adb reverse tcp:3000 tcp:3000`), the Revoke button silently
did nothing on both devices. Root cause, found via `Log.e` instrumentation
plus reading the actual HTTP response instead of assuming: **every bodyless
`DELETE` call in `BeaconApi.kt` was broken**, not just this new one. Android's
`HttpURLConnection` does not send a clean, header-free zero-length body for
`DELETE` the way `curl -X DELETE` or a browser's `fetch()` does; left to
its own defaults, it was hit with `FST_ERR_CTP_INVALID_MEDIA_TYPE` (backend's
Fastify has no parser for whatever content-type Android defaulted to), and an
explicit zero-length body with `Content-Type: application/json` got
`FST_ERR_CTP_EMPTY_JSON_BODY` instead (Fastify's JSON parser rejects an empty
body when that content-type is declared). The fix that actually works: send
an explicit `"{}"` body on every DELETE, mirroring the pattern
`deleteAccount` already used elsewhere in this file. Fixed at the shared
`connection()` helper (now sets `doOutput = true` for DELETE, not just
POST/PUT) plus added the explicit `"{}"` body write to every DELETE call site
that didn't already have one: `deleteRecording`, `revokeRecordingShareLink`,
`revokeHouseholdInvitation`, `removeHouseholdMember`,
`revokeBrowserSession`, and the FCM token unsubscribe call.

**This means clip deletion, share-link revocation, and notification
unsubscribe were silently broken on Android before this fix too** -- not
just the household-invitation/session-revoke features added this session.
None of those were ever exercised against a real device with a real network
round trip before now; they compiled and passed unit tests, which don't
catch this class of bug. Confirmed fixed end-to-end on real hardware: revoke
a signed-in device session on the Pixel, watch it disappear from the list on
next load, and independently verify server-side via `GET
/api/account/sessions` that it's actually gone. Full local gate
(`testDebugUnitTest lintDebug assembleDebug assembleRelease`) passes.
**Not independently re-verified on-device**: `deleteRecording`,
`revokeRecordingShareLink`, and the notification-unsubscribe call now share
the same fix but weren't individually re-tested against a real clip/share-
link/subscription after this change -- the shared root cause and identical
fix pattern make it very likely they now work, but that's inference, not a
fresh observation for those three specifically.

## September 27, 2026 — active continuation

The pending roadmap is ordered in `docs/roadmap.md` under **Ordered continuation
queue**. Pixel `34171JEHN07672` is connected and authorized again, so N1 is no
longer device-blocked, but its full evidence matrix is still open and must not be
claimed complete. The active branch is `codex/android-clips-library`, based on
the open parity-audit branch; do not work on `main`.

### September 27 follow-up (Claude Code): wide-screen responsive layout

The owner asked specifically that Android stay responsive across different
display sizes -- not just phones -- while matching the PWA's look, and asked
whether the existing native front end should be scrapped and rebuilt.
Recommendation: no. This branch's visual-system work (ADR 0080/0081, shared
tokens, Inter, the PWA-matched auth/nav screens) is sound and already tested;
throwing it away to fix a real but narrow gap would be wasteful. The actual
gap: nothing in the app read a window-size signal (`grep` for
`WindowSizeClass` across `apps/android-camera/app/src/main` returned nothing,
and no adaptive-layout dependency exists in `build.gradle.kts`), so the new
PWA-style drawer navigation would stretch across a tablet or unfolded
foldable instead of adapting, unlike the PWA itself.

Closed that gap without touching the drawer's tested phone behavior:
`MonitorNavigation.kt`'s `BeaconMonitorNavigation` (the modal drawer) had its
nav-item-list/account-menu/theme-switcher body extracted into a shared
private `BeaconSidebarContent`, now also used by a new `BeaconPermanentSidebar`
-- a non-dismissible, always-visible sidebar shown once the window is at
least `BEACON_WIDE_LAYOUT_MIN_WIDTH_DP` (600dp, Android's own conventional
phone/tablet breakpoint) wide, mirroring the PWA's own persistent-sidebar
behavior at wide viewports. `MonitorUi.kt`'s `MonitorHome` now reads
`LocalConfiguration.current.screenWidthDp` once and branches the root layout
between the existing top-bar+drawer chrome (unchanged, phones) and the new
sidebar-beside-content layout (tablets/foldables/Chromebooks); the entire
scrollable content column in between is untouched -- not duplicated -- so
every existing screen renders identically either way, just inside a
narrower or wider content pane.

Validated: `compileDebugKotlin` clean, then the full local gate
(`testDebugUnitTest lintDebug assembleDebug assembleRelease`) passes -- same
two pre-existing, unrelated Firebase deprecation warnings Codex already
noted, no new ones. Left uncommitted on `codex/android-clips-library`
alongside Codex's existing work, per the owner's continue-in-place
instruction; nothing pushed, deployed, or altered in production.

**Update: physically verified on real hardware.** The owner connected both
the Pixel (`34171JEHN07672`) and a Samsung tablet (`R52RC0B5AAX`, ~1200dp
wide, well over the 600dp breakpoint) via adb and authorized full control to
drive both devices for verification. Built a debug APK against the local dev
backend, tunneled to each device with `adb reverse tcp:3000 tcp:3000` since
neither device is the emulator. Hit and fixed a real bug in the process: the
debug network security config
(`apps/android-camera/app/src/debug/res/xml/network_security_config.xml`)
only allowlisted cleartext HTTP to `10.0.2.2` (the emulator's loopback
alias), so every request from a physical device silently failed
(`Sign in failed`, `Account could not be created`) with no exception
category the existing `userFacingMessage` mapping recognized -- confirmed by
the exact same request succeeding via `curl` straight to the backend, and
ruled out an app-logic bug by comparing the response shape `BeaconApi.kt`
expects against what the server actually returns (identical). Added a
second debug-only domain entry for `127.0.0.1`, alongside the existing
`10.0.2.2` one -- mirrors it exactly, still gated to the debug build variant
only, so release/production cleartext posture is unchanged.

With that fixed, created a local-only test account
(`beacon.review@example.test`, a `.test`-TLD address per RFC 2606, password
generated for this session) directly against the local dev backend and
signed in on both devices. Confirmed on the physical tablet: the permanent
sidebar renders at the correct 280dp-equivalent width (measured against the
tablet's own density, matched pixel-for-pixel), no top bar/hamburger is
shown, Home/Cameras/Events/Settings navigation all work, the Events
Activity/Clips tab switch and empty-state Clips screen (from this session's
sharing/thumbnail work) render correctly, and Settings' motion-retention,
notification, and account sections all render without error. Confirmed on
the physical Pixel: the phone still gets the original top-bar-plus-drawer
chrome (not the sidebar), and the drawer itself opens, closes, and lists the
same four destinations plus the account row -- i.e. the `BeaconSidebarContent`
extraction did not regress the already-shipped phone behavior. Real clip
playback/sharing/thumbnails remain unverified since this fresh test account
has no paired camera or uploaded clip -- that would need pairing a camera
and either waiting for motion or using the new manual-recording path, which
was out of scope for this pass.

### September 27 follow-up (Claude Code): Android clip sharing and thumbnails

Continuing U7's remaining Clips-library gaps per the owner's "keep
implementing" direction. Added to `BeaconApi.kt`: `downloadRecordingThumbnail`
(mirrors `downloadRecordingForPlayback`'s verify-then-decrypt contract against
the existing `GET /api/recordings/:id/thumbnail` route, but treats any
failure as "no thumbnail" rather than throwing, since a thumbnail is
decoration, not part of the recording lifecycle -- ADR 0078) and
`createRecordingShareLink`/`activeRecordingShareLink`/`revokeRecordingShareLink`
(against the existing `/api/recordings/:id/share-links` routes, ADR 0077). No
backend changes were needed -- confirmed `authenticateStateChange` already
treats a bearer-token request as CSRF-exempt, the same way Android's existing
manual-recording request already works, so these routes were already
reachable from a native client.

`RecordingLibrary.kt` gained a `RecordingThumbnailImage` composable (loads and
decrypts a clip's thumbnail if `hasThumbnail` is true, shows nothing at all
otherwise or on any failure) and a `ShareClipDialog` composable mirroring the
PWA's `ShareClipDialog.tsx` state machine and copy: check for an active link,
then either show it (copy/revoke/replace) or offer to create one (24/48/72h
picker plus a required consent checkbox, matching the PWA's exact disclosure
wording). Wired into `MonitorUi.kt` via one new hoisted `recordingShareTarget`
state var, following this file's existing convention for Clips-screen state.

Validated: `compileDebugKotlin` clean on the first attempt for both additions,
then the full gate (`testDebugUnitTest lintDebug assembleDebug assembleRelease`)
passes, same two pre-existing unrelated warnings, no new ones. **Not
validated**: no real clip fixture existed in this environment to exercise
thumbnail display or share-link creation against an actual recorded clip --
compile/lint/unit-test verified only. Household/sharing _management_
(invite/accept/revoke/grants -- distinct from clip _share links_) remains
entirely unimplemented and unstarted; it's a larger, separate feature and was
deliberately not started in this same pass. Left uncommitted on
`codex/android-clips-library` alongside everything above.

The current uncommitted implementation adds an Android Clips library,
grant-filtered listing through the existing `/api/recordings` contract,
size/checksum verification followed by local AES-GCM decryption for playback,
temporary app-cache cleanup, pagination, and owner-only deletion controls. It
does not add a schema or weaken backend authorization. U7 now also bundles Inter
under its license, centralizes the PWA token scales, matches the installed PWA's
mobile top bar/sidebar/account menu, groups Activity and Clips under Events,
adds theme selection and system-bar contrast, and matches the installed PWA's
signed-out/password-reset/registration screens. Native account creation now uses
`/api/mobile/auth/register`, sharing the browser path's password policy, IP
rate-limit bucket, duplicate handling, verification-email behavior, and session
issuer while returning a revocable bearer token. Sharing, Android thumbnails,
and household management remain later slices. Android manual recording is now
implemented locally as a backend-authorized 15-second camera capture: the owner
request creates the normal audited recording row, the backend alone commands the
authenticated camera socket, and the camera reuses its visible CameraX capture,
AES-GCM encryption, Drive upload, and failure paths. Viewer and camera indicators
match the PWA lifecycle language. Backend/APK deployment and a real Drive-backed
capture remain open. The Android camera-settings screen also exposes the
existing motion contract: per-source
detection, sensitivity, record-on-motion, cooldown, and time-zone-aware quiet
hours can be loaded and saved by owners/admins without adding a second policy or
schema.

The production-targeted debug APK was installed without clearing Pixel data.
Home, the drawer/account menu, Events/Activity, and the empty Clips screen were
visually checked on device; a temporary signed-out preview was used without
modifying the stored session, then removed. Real clip playback/deletion is still
unproven because this household has no clip fixture. Registration UI was also
previewed without submitting or creating an account; production acceptance must
wait until the new backend route is deployed. The motion panel's real-device
empty state was inspected on the Pixel. This household's current device returned
no editable motion rows, so a physical save/apply round trip remains open. The
dedicated PostgreSQL auth
suite passes all 23 tests; the complete backend gate passes TypeScript,
repository ESLint, all 43 test files / 227 tests, and the Android gate passes
`testDebugUnitTest`, `lintDebug`, `assembleDebug`, and `assembleRelease` with
the production API URL injected. `git diff --check` and the documentation
Prettier check also pass. The existing Firebase deprecated-override compiler
warning remains unrelated to this slice.

PR #76 (parity audit) and PR #75 (dead web component removal) remain open. Their
GitHub jobs did not start because of the account billing/spending-limit state.
The parity documentation also needs Prettier cleanup before merge. Do not merge,
push, deploy, or alter production merely to continue this local branch.

## September 26, 2026 — handoff to next session (docs committed, no implementation started)

This section supersedes the September 25 section below for **current state and
next steps**; the September 25 section's environment setup, Oracle access, and
deploy procedure are still accurate and still the ones to use. This handoff was
written because the current session is ending (usage limit). Read
[AGENTS.md](../AGENTS.md) and [roadmap.md](roadmap.md) first, then this.

### What happened this session

1. PR [#72](https://github.com/builtbysai/Beacon-SecureView/pull/72) and PR
   [#73](https://github.com/builtbysai/Beacon-SecureView/pull/73) were merged to
   `main` and manually deployed to production (`https://beacon.builtbysai.com`).
   They cover: Activity feed split from a Clips library with clip↔motion-event
   association, keyset pagination, per-camera-grant clip read access,
   time-limited external share links (ADR 0077), client-captured encrypted
   thumbnails for browser clips (ADR 0078), a persistent accessible
   `RecordingBadge` replacing the old dead `data-tooltip` indicator, and
   intentional (non-silent) recording abort when the source stream drops or
   ends (ADR 0079). GitHub Actions CI was (and, verify, may still be) blocked by
   a **billing failure**, not a code problem (`gh api
repos/builtbysai/Beacon-SecureView/actions/runs` will show it, or check
   billing on github.com/settings/billing) — both merges were done with the
   owner's explicit approval to merge without CI, after manually reproducing
   every `.github/workflows/*` job locally first. Do the same if CI is still
   blocked when you pick this up: don't assume it's a code regression.
2. Old release directories and stopped containers on the Oracle VM were cleaned
   up conservatively (only clearly-safe auto-generated build artifacts;
   **nothing** ambiguous, no secrets, no keys, no `.env` files were touched).
3. The owner opened three new workstreams in one message, then added a fourth
   (baby monitor) shortly after. **All four are decisions/research only —
   none are implemented on either platform:**
   - **Approved roadmap item N5 (MFA/passkeys)**: "yes we can add MFA and
     passkey where applicable and on devices that support it." No MFA/passkey
     code exists on either platform (confirmed by grep for
     `webauthn|passkey|WebAuthn|Passkey` across `apps/backend/src`,
     `apps/web-viewer/src`, `apps/android-camera/app/src/main/java` — zero
     matches). Proposed shape recorded in
     [core-feature-completion-plan.md](core-feature-completion-plan.md)'s
     Step 7 (WebAuthn/passkey for web as primary path since it needs no new
     OTP delivery channel; Android Credential Manager passkeys where
     supported; password fallback everywhere). **Open design question before
     implementing**: can a passkey be the _only_ credential on an account, and
     what's the recovery story if the authenticator is lost? Needs an owner
     decision, not an engineering guess.
   - **Camera use-case profiles research** — doorbell, car/dash camera, baby
     monitor/nursery camera, and the existing always-on profile. Written up in
     full in the new [camera-use-case-profiles.md](camera-use-case-profiles.md)
     (see next section for the summary). This is the completed deliverable for
     "take your time and do some research... think about the plan to
     implement them" — **research and phased plan only, zero implementation.**
   - **Android/web parity pass** — make the Android app's UI match the PWA's
     current look ("exactly identical," owner's words) and audit both
     platforms so neither is missing features the other has. Recorded as row
     **U7** in [roadmap.md](roadmap.md) and in
     [core-feature-completion-plan.md](core-feature-completion-plan.md)'s
     Step 6. **No audit has been started.** Explicitly: do not begin visual or
     feature work until the audit/gap-list exists and the owner has reviewed
     it — Compose cannot literally copy CSS, so "identical" needs to be
     translated into layout/color/type/spacing intent first.

### Camera use-case profiles — what the research concluded

Full detail in [camera-use-case-profiles.md](camera-use-case-profiles.md).
Short version for orientation:

- **Regular/Always-on** — today's behavior, unchanged, no work needed.
- **Doorbell** — a named preset over _existing_ motion-settings columns (high
  sensitivity, short cooldown, record-on-motion on, maybe elevated
  notification priority). No new capture code. A literal hardware doorbell
  button is out of scope (Beacon runs on phones, not purpose-built doorbell
  hardware) unless the owner wants to scope Bluetooth-button pairing
  separately later.
- **Car/Dashcam** — same preset pattern, plus a genuinely new trigger: reading
  the phone's built-in accelerometer as an impact detector (a real analog to
  a dash-cam's G-sensor), producing a protected short clip. **True
  continuous/loop recording while driving is explicitly excluded from this
  proposal** — it conflicts with this repo's stated hard boundary of no
  continuous or hidden recording ([roadmap.md](roadmap.md),
  [product-build-brief.md](product-build-brief.md)) and needs its own,
  separate owner privacy sign-off before anyone builds it.
- **Baby monitor/nursery** — the easiest of the four. Beacon already has
  always-on live view and consent-gated Listen/Talk; this profile is mostly a
  UX/defaults preset (surface Listen/Talk prominently, turn off
  motion-triggered recording by default since crib movement isn't a security
  event). An optional cry-detection alert would be a new small audio-level
  (decibel/frequency) detector — deliberately **not** speech or voice
  analysis, which would cross into the biometric/identity territory this
  repo's privacy rules already forbid. Phone hardware cannot match
  purpose-built nursery cameras on night vision/IR; the doc says so plainly
  rather than overselling it.
- **Recommended order**: ship the Phase-1 presets for all three
  event-oriented profiles (Doorbell, Car, Baby monitor) together first — low
  risk, no new detectors, no boundary conflicts. New detectors
  (accelerometer, cry-detection) are an optional Phase 2 per profile.
  Continuous driving recording stays a separate, later, owner-gated decision.

### Docs status: fully committed, nothing pending

Everything from this session is committed on branch
`codex/camera-profiles-and-roadmap-docs` (commits `8e6e965` and the one
finalizing baby monitor + this section) — **not pushed, no PR opened**, since
that wasn't explicitly requested. `docs/roadmap.md` has been updated (N5 row
reworded to reflect the MFA/passkey approval, new row U7 for the parity pass,
a September 26 narrative entry, and new "Decisions requiring the owner"
items for the camera profiles and parity sequencing).
`core-feature-completion-plan.md`'s dangling link to
`camera-use-case-profiles.md` is resolved — the file exists and is
cross-referenced from all three docs consistently.

There is also an untracked `.codex-remote-attachments/` directory at the repo
root (a Codex remote-session artifact, not something this session created).
Left untouched deliberately — don't delete it without checking whether a
Codex session still owns it.

### Next steps for whoever picks this up

1. If you want this docs batch on `main`: push
   `codex/camera-profiles-and-roadmap-docs` and open a PR. Reproduce
   CI-equivalent checks locally first if GitHub Actions billing is still
   blocked (see point 1 under "What happened this session").
2. **Do not start implementing MFA/passkeys, any camera-use-case profile, or
   the Android/web parity audit without checking in with the owner on
   sequencing first.** Four substantial workstreams were opened in this
   session alone, and this repo's own rule is one approved milestone at a
   time (AGENTS.md: "Do not begin a later milestone without explicit
   approval"). Propose an order; don't assume one. The camera-profiles doc's
   own recommendation (Phase 1 presets first, across all three profiles) is a
   reasonable starting suggestion, not a decision already made.
3. Start the Android/web parity audit (U7) as documentation/analysis only —
   enumerate screens/controls on both platforms — before writing any UI code,
   once the owner confirms this should be next.

### Where to get keys and access

Nothing changed here this session — see "Do not put keys in this repository"
in the September 25 section immediately below for the full table (GitHub,
Oracle SSH via Tailscale, production/backup `.env` files on Oracle, Firebase
Android config, Google OAuth). This session used pre-existing Tailscale/SSH
access already configured on this machine; no new credentials were created,
rotated, or discovered.

## September 25, 2026 — current continuation state

This section supersedes older deployment, backup, and active-branch statements below.
Read [AGENTS.md](../AGENTS.md), [roadmap.md](roadmap.md), and this section before
editing. GitHub `main` is the canonical base; do not work directly on it.

### Do not put keys in this repository

This handoff identifies the access material a new environment needs, but does not
contain secret values, private keys, tokens, `.env` files, Android signing material,
or certificates. Obtain them from the owner through the approved private channel.

| Need                                  | Where it belongs                                                                                    | Notes                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GitHub repository access              | GitHub account / credential manager                                                                 | Repository: `builtbysai/Beacon-SecureView`.                                                                           |
| Oracle administrative SSH private key | User-private SSH directory or approved secret manager                                               | Never copy into the repository or a shared Downloads folder.                                                          |
| Oracle host key                       | `~/.ssh/known_hosts` from an approved source                                                        | Keep strict host-key checking enabled.                                                                                |
| Tailscale identity                    | Tailscale client signed into the Beacon tailnet                                                     | Oracle SSH is tailnet-only; public SSH is intentionally closed.                                                       |
| Production application configuration  | `/etc/beacon/production.env` on Oracle, root-owned mode `600`                                       | Includes database, TURN, OAuth, Drive-recording, notification, and application secrets. Do not print or copy it.      |
| Backup configuration                  | `/etc/beacon/backup.env` on Oracle, root-owned mode `600`                                           | Object Storage credentials and Restic password; currently retained empty by owner request.                            |
| Firebase Android configuration        | User-private `google-services.json`, installed by `scripts/Install-BeaconFirebaseAndroidConfig.ps1` | The destination is ignored by Git.                                                                                    |
| Google OAuth and Drive configuration  | Production environment only                                                                         | Browser sign-in, Drive connection, and recording export cannot be reproduced without owner-managed OAuth credentials. |

### New development environment

Use Windows PowerShell from `C:\Dev\Beacon-SecureView` (or an equivalent clean
checkout). Install Node 22.13+ within Node 22, pnpm 11.9.0, Docker Desktop with
Compose, JDK 17, Android SDK Platform 35, Android platform tools, GitHub CLI, and
Tailscale. For Android Studio's bundled JDK on this machine, use
`C:\Program Files\Android\Android Studio\jbr\bin\java.exe` directly when the
shell does not expose `JAVA_HOME`.

```powershell
git clone https://github.com/builtbysai/Beacon-SecureView.git C:\Dev\Beacon-SecureView
Set-Location C:\Dev\Beacon-SecureView
pnpm install --frozen-lockfile
.\Start-Beacon.ps1
```

`Start-Beacon.ps1` creates ignored local configuration when needed, starts local
PostgreSQL and Coturn, applies migrations, starts the secure local development stack,
and opens the viewer. Stop it with `.\Stop-Beacon.ps1`; run the ordinary validation
with `.\Test-Beacon.ps1` or `pnpm check`.

For a physical Android device on a trusted LAN, install the owner-provided Firebase
configuration first, then follow [physical-android-device-development.md](physical-android-device-development.md).
The current Pixel is serial `34171JEHN07672`. Preserve its app data; do not clean
install or clear it unless the owner explicitly asks.

Before beginning a change, inspect other work and create a branch:

```powershell
git fetch origin --prune
git worktree list
git branch -r
git switch main
git pull --ff-only
git switch -c codex/<short-description>
```

Run the focused checks while developing, then `pnpm check`. Android's full local
gate on this Windows host is:

```powershell
& 'C:\Program Files\Android\Android Studio\jbr\bin\java.exe' `
  -classpath apps/android-camera/gradle/wrapper/gradle-wrapper.jar `
  org.gradle.wrapper.GradleWrapperMain -p apps/android-camera --no-daemon `
  testDebugUnitTest lintDebug assembleDebug assembleRelease
```

### Connecting to Oracle

Connect Tailscale first. Configure a local SSH alias using the owner-provided private
key and known-host entry; this is the shape of the current configuration, with the
key filename intentionally omitted:

```sshconfig
Host beacon-oracle
    HostName beacon-secureview-oracle
    User ubuntu
    IdentityFile ~/.ssh/<owner-provided-beacon-key>
    IdentitiesOnly yes
    HostKeyAlias 129.213.128.206
    StrictHostKeyChecking yes
```

Then verify private access without exposing configuration values:

```powershell
ssh beacon-oracle "hostname; date -Is"
ssh beacon-oracle "sudo docker ps --format '{{.Names}}|{{.Status}}'"
ssh beacon-oracle "sudo systemctl list-timers 'beacon-backup*' --all --no-pager"
```

Oracle layout:

- Compose project: `beacon-secureview-cloud`
- Release directories: `/opt/beacon/releases/web-<full-git-sha>`
- Current production environment: `/etc/beacon/production.env`
- Backup environment: `/etc/beacon/backup.env`
- Services: `postgres`, `backend`, `web`, and `coturn`
- Public private-alpha URL: `https://beacon.builtbysai.com`

Never expose PostgreSQL, backend port 3000, production environment files, private
keys, or TURN secrets. Use `sudo docker logs beacon-secureview-cloud-backend-1 --tail 100`
for redacted backend diagnostics and `https://beacon.builtbysai.com/health` plus
`/ready` for public liveness/readiness checks.

### Deploying a reviewed commit

`Deploy Beacon to Oracle` is currently **disabled manually**, so merging does not
automatically deploy. Do not re-enable it without an explicit decision about future
automatic releases. Deploy the exact reviewed `main` commit manually with the same
sequence the workflow uses:

1. Record the full SHA with `git rev-parse HEAD`; ensure it is the intended merged
   `main` commit and its CI run is successful.
2. Create `git archive --format=tar.gz` for that SHA and copy it to
   `/tmp/beacon-<sha>.tar.gz` on `beacon-oracle`.
3. On Oracle, extract it into `/opt/beacon/releases/web-<sha>`.
4. Use that release's `infrastructure/cloud/compose.yaml` with both root-owned
   environment files. Build `backend`, `migrate`, `migrate-verify`, and `web`; bring
   up PostgreSQL; run migration and migration-schema verification; then replace only
   backend and web.
5. Check local TLS-routed `/health` and `/ready`, public `/health` and `/ready`,
   container status, and backend startup logs.

Use this remote command pattern after the archive is uploaded. It deliberately uses a
release directory and never overwrites `/opt/beacon/app` or reads secret values into
the terminal:

```bash
set -euo pipefail
release_sha='<full-reviewed-sha>'
release_dir="/opt/beacon/releases/web-${release_sha}"
compose_file="${release_dir}/infrastructure/cloud/compose.yaml"
env_files=(--env-file /etc/beacon/production.env --env-file /etc/beacon/backup.env)

sudo install -d -m 0755 "$release_dir"
sudo tar --extract --gzip --file "/tmp/beacon-${release_sha}.tar.gz" --directory "$release_dir"
rm -f "/tmp/beacon-${release_sha}.tar.gz"

sudo docker compose --project-name beacon-secureview-cloud "${env_files[@]}" --file "$compose_file" build backend migrate migrate-verify web
sudo docker compose --project-name beacon-secureview-cloud "${env_files[@]}" --file "$compose_file" up -d postgres
sudo docker compose --project-name beacon-secureview-cloud "${env_files[@]}" --file "$compose_file" run --rm --interactive=false migrate
sudo docker compose --project-name beacon-secureview-cloud "${env_files[@]}" --file "$compose_file" run --rm --interactive=false migrate-verify
sudo docker compose --project-name beacon-secureview-cloud "${env_files[@]}" --file "$compose_file" up -d --no-deps backend web

domain=beacon.builtbysai.com
curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors --resolve "${domain}:443:127.0.0.1" "https://${domain}/health" >/dev/null
curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors --resolve "${domain}:443:127.0.0.1" "https://${domain}/ready" >/dev/null
```

The explicit `migrate-verify` step is mandatory. Migrations have historically printed
success while missing schema work; do not replace it with the migration command alone.
For a migration that changes schema, independently query only the relevant catalog
shape and avoid dumping application data. See [github-web-deployment.md](github-web-deployment.md)
and [oracle-cloud-staging.md](oracle-cloud-staging.md) for rollback and recovery limits.

### Backup and database state

The owner cleared application data, accounts, and Restic snapshots on September 23.
The Oracle backup repository currently remains empty and both scheduled backup timers
are disabled. PR #64 recorded a temporary snapshot/isolated restore drill, then removed
the verification database and pruned that snapshot so the empty-backup state remained.
PR #65 hardened the restore verifier: it refuses the live or any nonempty target
database, and verifies migration/public-table presence after restore.

Do not enable backup timers, write directly to the production database, restore over
the live database, or create retained backups unless the owner explicitly asks. A future
restore drill must create a separate empty verification database, use the explicit
`BEACON_ALLOW_DESTRUCTIVE_RESTORE=RESTORE_A_SEPARATE_DATABASE` marker, compare aggregate
counts without exposing users, and drop the verification database afterward.

### Current branch and immediate next work

At this handoff:

- `main` includes production recording CORS repair (PR #63), backup restore proof
  (PR #64), and restore-verifier hardening (PR #65).
- PR #66, `codex/android-privacy-evidence`, has passing CI and records the successful
  unlocked Pause/Resume privacy control test. It has an additional uncommitted Android
  service fix and must not be merged as documentation-only until that fix is completed,
  tested, committed, and its PR title/body are updated.
- The uncommitted fix in
  `apps/android-camera/app/src/main/java/com/beaconsecureview/camera/CameraForegroundService.kt`
  handles a real Pixel regression: when Android revokes `CAMERA`, it kills and can
  restart the sticky service; `onCreate()` immediately attempted a camera foreground
  service and Android threw `SecurityException`. The draft change stops the service
  before it declares a camera FGS type and makes the restart non-sticky while camera
  permission is absent.
- The Pixel's camera permission was restored after reproducing the crash and its live
  camera capture resumed. A freshly rebuilt debug APK exists locally but still needs
  installation with `adb install -r <apk>` and the physical permission-revocation
  regression test. Preserve the app data.

Finish this in order: inspect the uncommitted diff; run Android unit/lint/build;
install the debug APK with `-r`; revoke `android.permission.CAMERA`; verify there is no
crash and Beacon presents the permission request; grant camera permission through the
normal UI; verify the service and preview return; update tests and this evidence record;
then push a focused PR. Do not claim the camera-denied flow is complete until that run
passes.

### Remaining roadmap

`docs/roadmap.md` is authoritative. The near-term items are:

| Priority         | Work remaining                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 N1            | Finish Android physical recovery: camera-denied flow above, active-Listen microphone release, remote frame check after every lens switch, late-viewer behavior, and network loss/recovery.                 |
| P0 N2            | Physical Google chooser/cancel/return, Listen/Talk consent and teardown, speaker/Bluetooth/echo, competing talk owners, direct and forced TURN across separate networks.                                   |
| P0 N3            | Recovery drill now has a successful isolated proof, but scheduled retention evidence, RPO/RTO, recovery operator, and a deliberate decision on enabling timers remain open.                                |
| P0 N4/N7         | Owner decisions and review: email/domain identity, sender DNS evidence, support/incident operator, retention disclosures, legal/trust publication.                                                         |
| P0 N5/N6         | MFA/passkey decision, native/physical security-alert evidence, independent security review, Android signing/AAB/versioning, rollout and Play readiness.                                                    |
| P1 N8/N9         | Accessibility and responsive physical-device checks; older-device capacity, thermal, battery, bandwidth, and long-session recovery measurements.                                                           |
| Recording        | Retest browser recording after PR #63: capture, direct Drive upload, playback, failure retry, removal, and Drive verification. Android real-account recording/upload/playback is still an acceptance gate. |
| Sharing and push | Inbox/bounce evidence, multi-account sharing acceptance, native FCM or installed-PWA notification evidence, invalid-token cleanup, quiet hours, and lock-screen redaction.                                 |
| Deferred         | IoT adapters, IP cameras, cross-platform native clients, cloud-synced workspaces, smart detection, subscriptions, ads, and biometric features require separate approval.                                   |

Do not start a deferred item from the last row without an approved design milestone.

Updated September 23, 2026. This is the shortest reliable orientation for a new
development session. GitHub is canonical; the maintained local checkout is
`C:\Dev\Beacon-SecureView`.

## September 23 development data reset

At the owner's request, all application data and accounts in the Oracle PostgreSQL
`public` schema were cleared. The 27 Drizzle migration ledger rows were preserved.
All Restic snapshots were forgotten and pruned; the repository currently has zero
snapshots. The `beacon-backup.timer` and `beacon-backup-check.timer` systemd units
are disabled and inactive so the backup set remains empty during development.
Re-enable backups before relying on this VM for retained user data. OCI bucket
object versioning was not independently checked, so historical object versions
are not covered by the Restic verification.

## Read this first: check for other active work before developing

**Before planning or editing anything**, run all three of these — skipping
them previously caused a near-miss where a PR built on a stale `main` almost
overwrote unrelated, already-deployed production work:

1. `git branch -r` and `git worktree list` — this repository is worked on by
   both Codex and Claude Code sessions, sometimes concurrently in a second
   local worktree (historically `~/.codex/worktrees/<id>/Beacon-SecureView`)
   with its own uncommitted, in-progress work. If you find one, treat its
   modified files as off-limits — read them if useful for context, never
   edit, commit, or build conflicting functionality against them without
   checking with the owner first.
2. Read this file and [roadmap.md](roadmap.md) on whatever branch is
   currently checked out in any such worktree, not only on `main` — `main`
   can be, and has been, several days and many commits behind the branch
   actually running in production.
3. Check what Oracle is actually running before assuming GitHub and
   production agree: `ssh beacon-oracle` (Tailscale-only; public SSH is
   closed, see ADR 0045), then `sudo docker compose --project-name
beacon-secureview-cloud ps` and `ls -lt /opt/beacon/releases/ | head`.

## September 16: recording actually captures/uploads now (owner-scoped ask to Codex below)

The owner's ask that started this: "fix the recording and cloud recording. test
it and make sure it works", then, when asked whether to close the gap on
browser and/or Android: "Both browser side and android side. Any camera can
capture based of motion or other settings. The browser/viewer can also
manually capture. Both devices should be able to capture and upload." Commit
`314ff37` on `main` (built on top of `bce74c5`, see below) delivers that.

**What was actually broken.** Recording had never worked for the owner despite
earlier attempts. Root cause: `POST /api/recordings`'s audit-log call passed
`camera.cameraId` (the camera-_source_ id) into `store.audit({ cameraId })`,
which is FK'd to `cameras.id` (the _device_ id) — every single recording
request crashed with a 500 from the `audit_events_camera_id_fkey` violation,
before any capture logic could ever run. Fixed in `bce74c5` (one line: use
`camera.deviceId`). The rest of the HTTP lifecycle (`request` →
`upload-session` → `complete` → list/delete, plus the device-credential
variants) already worked correctly once that crash was gone — confirmed by a
new 10-case integration suite,
`apps/backend/test/recording-routes.integration.test.ts`.

Separately, and more importantly: **nothing on either platform had ever
actually captured or uploaded a clip.** The request/status state machine and
the Drive resumable-upload plumbing (`initiateDriveRecordingUpload`,
`finalizeRecordingUpload` / `verifyDriveRecordingFile`) existed from the
September 15 port (ADR 0051) but had no caller. `314ff37` closes that end to
end on both platforms:

- **Browser, manual (both viewer and browser-camera modes).** New
  `apps/web-viewer/src/recording-capture.ts` (`ClipRecorder` around
  `MediaRecorder`, `uploadClipToDrive` doing the raw `PUT` to the Drive
  session URL) and `useClipRecorder.ts` (request → capture → upload →
  complete orchestration hook, with elapsed-timer display and a
  `MAX_CLIP_DURATION_MS` auto-stop). Wired into `LiveVideo.tsx`'s existing
  record button and into a new record control in `BrowserCameraMode.tsx`
  (owner-gated). Fully tested (jsdom has neither `MediaStream` nor
  `MediaRecorder` as globals — tests stub both; production code guards
  `instanceof MediaStream` behind `typeof MediaStream !== 'undefined'` so it
  can't throw in that environment).
- **Backend, motion-triggered auto-record.** New per-camera-source
  `motion_record_enabled` column (`recordOnMotion` in the API), server-
  authoritative: the device never decides for itself, it just acts on a
  `recordingId` the server hands back in the motion-event report response
  when eligible (setting on, owner's Drive connection has the recording
  scope, no recording already in flight for that camera source) — see
  `Store.createMotionTriggeredRecording` in `store.ts` and the
  `POST /api/device/cameras/:cameraId/motion-events` handler in
  `device-runtime-routes.ts`. This piggybacks on the existing motion-report
  round trip rather than adding a new server→device signaling channel. New
  "Record a short clip when motion is detected" checkbox in
  `MotionSettingsPanel.tsx` — this UI control was _missing_ on first pass
  (schema/API shipped with no way to turn it on) and was caught by a
  read-only verification subagent, then added.
- **Android, capture + auto-record.** `CameraXVideoCapturer.kt` gained an
  optional third concurrent CameraX use case (`VideoCapture<Recorder>`,
  `QualitySelector.fromOrderedList([SD, HD], ...)`). Binding is tried with
  all three use cases first; on **any** failure it unbinds and rebinds with
  just the original two (`preview`, `imageAnalysis`) — reusing this
  codebase's own proven lens-flip unbind/rebind pattern, so hardware that
  can't support the extra stream never regresses live view. New
  `MotionClipUpload.kt` (streaming SHA-256, raw `HttpURLConnection` PUT to
  the Drive session URL). `CameraForegroundService.kt` acts on the
  `recordingId` the motion-event response returns and drives the
  upload/complete calls. `google-services`/Gradle: added
  `androidx.camera:camera-video:1.4.2`.

**Validated:** backend (`tsc -b`, `eslint`, `prettier --check`, 200/200 tests,
`build`), web-viewer (`typecheck`, `eslint`, 168/168 tests, `build`), Android
(`compileDebugKotlin`, `testDebugUnitTest`, `lintDebug`, `assembleRelease` —
all green). **Not validated:** the Android capture path has never run on
physical hardware. It builds and passes every automated gate available in
this environment, but the 3-stream CameraX bind and the `Recorder`
encoder/muxer are unverified in practice — needs the owner's Pixel
(`34171JEHN07672`, preserve app data). Also still open, deliberately not done
this pass: ADR 0051 calls for the camera to encrypt a clip before upload;
neither the browser nor Android implementation does that yet — clips upload
as plain `video/webm`/whatever `MediaRecorder`/`Recorder` produces. Flag this
before treating recording as release-ready.

**Deployed to production same session.** `314ff37` is live at
`https://beacon.builtbysai.com` (`DEPLOYED_COMMIT` updated). See the next
section — the deploy surfaced a real bug worth independent investigation.

### Ask for Codex: bug-hunt why `drizzle-kit migrate` silently no-ops

This bit twice in one session, local **and** production, and the root cause
was never found — only worked around. Sequence on production, exactly
reproducing what had already happened locally a few hours earlier: migration
`0025_motion_record_enabled.sql` (`ALTER TABLE "camera_sources" ADD COLUMN
"motion_record_enabled" boolean DEFAULT false NOT NULL;`, generated cleanly
via `drizzle-kit generate --name motion_record_enabled` against a valid
snapshot chain) was applied via
`docker compose ... run --rm migrate`, which printed:

```
[⣷] applying migrations...[✓] migrations applied successfully!
```

— and the row for migration id 25 (correct sha256 hash of the file) was
genuinely present in `drizzle.__drizzle_migrations` afterward. But the column
did not exist: `SELECT column_name FROM information_schema.columns WHERE
table_name='camera_sources' AND column_name='motion_record_enabled'` came back
empty, confirmed by direct `psql`. I.e. drizzle-kit marked the migration as
applied _without the DDL ever running against the database_ — no error, no
partial-apply warning, nothing in the tool's own output to suggest anything
was wrong. Both times, the workaround was the same: run the `ALTER TABLE`
statement by hand (the tracking row already existed, so just the DDL, nothing
else needed touching).

This is a serious trust problem for the migration tool specifically, not a
one-off typo: `db:migrate` reporting success is the only signal this project's
deploy procedure currently checks before moving on to rebuilding/restarting
the app containers. If a future migration's silent no-op leaves a column or
table missing that new code actually reads/writes on the hot path (unlike
this one, whose column had a safe default and no reader until the same
deploy's app code shipped), that's an outage, not a shrug.

Please dig into why. Starting points, none confirmed:

- Is `drizzle-kit`'s CLI actually executing the SQL file's statements inside a
  transaction/connection that then gets rolled back or discarded silently
  (e.g. a driver/pool mismatch between what `drizzle.config.ts` configures
  and what the `migrate` runner actually connects to)?
- Version pinned in `apps/backend/package.json` — is this a known upstream
  issue for that specific `drizzle-kit`/`drizzle-orm` version pair? Check
  their changelog/issue tracker.
- Does it reproduce reliably with a minimal single-statement migration against
  a clean local Postgres, or does it need the specific history/size of this
  project's migration chain to trigger?
- `docs/development-handoff.md`'s September 10 entry already flagged a
  related-but-distinct drizzle quirk (`drizzle/meta/` has no intermediate
  snapshot JSON in _some_ history, so a bare `generate` recreates every
  table) — confirm whether that's the same root cause resurfacing
  differently, or a separate issue.
- Whatever you find, the fix should make a bad apply loud (fail the command,
  or add a post-apply verification step the deploy procedure actually
  checks), not just patch this one instance quietly.

## September 14-15 merge: main is now the production line

`main` had drifted ~4 days and 16+ commits behind `codex/notification-transport-v1`,
which was the branch actually deployed to Oracle (household sharing, notification
transport, Google Drive backup foundation, camera reliability fixes, and the
Tailscale-based private deploy workflow, ADRs 0044-0050). A parallel `codex/
android-experience-overhaul` branch had independently rebuilt the same backend/
Android maintainability split with a different implementation; its genuinely new
fixes (an Android live-view reconnect that froze video, a `session!!` race that
could crash the Monitor app on session expiry, and several web-viewer bugs) were
re-applied on top of `codex/notification-transport-v1` instead of merging that
whole branch, since both had independently built the same refactor.

`codex/notification-transport-v1` (with those fixes, plus a household-invitation
resend action and negative-authorization test coverage added on top) has now been
merged into `main` and pushed, restoring `main` as the accurate source of truth.
All now-stale/fully-merged branches were deleted on GitHub and locally; only
`main`, `codex/notification-transport-v1` (kept because a Codex worktree still had
it checked out with uncommitted work), and `claude/continue-from-notification-transport-v1`
remain.

## September 15: recording foundation + FCM token fix ported from the Codex worktree

The uncommitted work described in the previous paragraph (as it stood at the
September 14-15 merge) was confirmed abandoned by the owner and has now been
ported onto `main` in two commits: a real Android bug fix (FCM push
registration was sending the Firebase Installation ID instead of the actual
messaging token, so device push could never have worked — `onNewToken`/
`messaging.token` now used throughout, backend accepts `token` with `fid` kept
only for one rollout cycle), and the full user-owned recording foundation
(migration 0018, `recording-routes.ts`, `postgres-recording-repository.ts`,
the `drive.file`-scoped recording OAuth variant in `authentication-routes.ts`/
`google-drive-client.ts`, ADR 0051, and `docs/core-feature-completion-plan.md`).
Full repo check (`format:check`, `lint`, `typecheck`, backend `test`, `build`)
and the Android gradle gates (`compileDebugKotlin`, `testDebugUnitTest`,
`lintDebug`, `assembleRelease`) all passed before committing.

Per `core-feature-completion-plan.md`'s execution order — (1) notifications/
security events, (2) household sharing completion, (3) account recovery/
hardening, (4) recording + Drive export, (5) integration/operational proof,
(6) UI/UX pass, (7) release gate — this lands step 1's token fix and most of
step 4's backend contract. Still open: step 1's security-event outbox and
native/physical FCM acceptance; step 2's remaining inbox/bounce evidence and
recording grants; step 3 (account recovery/hardening) has no implementation
yet; step 4 still needs the Android capture/upload client and the web
recording UI (intentionally deferred to step 6). The stale Codex worktree at
`~/.codex/worktrees/0235/Beacon-SecureView` still holds the now-superseded
uncommitted diff this was ported from — do not port it again; it can be
discarded once confirmed no longer needed.

## September 15 fix: automated deploy's Tailscale OIDC trust credential

The `Deploy Beacon to Oracle` workflow's `tailscale/github-action` step was
failing every run with `token exchange failed with status 403` because the
Tailscale trust credential's configured OIDC **Subject** used the classic
GitHub Actions format (`repo:builtbysai/Beacon-SecureView:environment:production`),
while this repo has `use_immutable_subject: true` set (check via `gh api
repos/builtbysai/Beacon-SecureView/actions/oidc/customization/sub`), so
GitHub actually issues tokens with org/repo IDs baked in instead:
`repo:builtbysai@37721651/Beacon-SecureView@1309277283:environment:production`.
Tailscale's edit-credential page shows exactly this mismatch under "Cannot
validate subject" — it echoes back the literal subject it received from the
last token, which is the fastest way to diagnose this class of failure again.

Fixed by updating the trust credential (Tailscale admin console → Settings →
Trust credentials → the `TV73JXogci...` OIDC credential → Edit) to the
immutable-ID subject shown above; Client ID and Audience were untouched. This
is a durable fix, not a one-off: `sub_claim_prefix` is a fixed, persistent
per-repo GitHub setting (immutable IDs never change even across repo/org
renames), so every future run against the `production` environment will keep
emitting this exact subject. It would only break again if someone
deliberately flips `use_immutable_subject` back to `false` on the repo, or if
the trust credential itself is deleted/recreated with the old-format subject
typed in again.

## September 12 interface-reliability follow-up

The owner approved a bounded follow-up after the Chrome Web Push baseline: modernize
the existing web sidebar without installing shadcn, keep the collapsed account menu's
Trust & privacy and Sign out actions reachable, restructure notification settings, and
make Android camera disconnect available whether capture is live or paused.

The web sidebar now has a sticky header/footer, independently scrollable navigation,
icon-collapse rail, `Ctrl`/`Cmd`+`B` toggle, active-state treatment, portal-rendered
tooltips, and a portal-rendered account menu that cannot be clipped by the collapsed
shell. Notification settings now separate browser delivery status from responsive
per-camera alert cards, use switch controls, expose unsaved state, and avoid redundant
saves. No component framework was added.

Android now exposes Disconnect beside Pause and in the overflow menu, confirms the
destructive action, clears the local device credential before stopping the foreground
capture service, and performs server removal as best-effort cleanup. This prevents a
network failure from leaving the phone capturing or able to restart with the old
credential. The Pixel currently reports that its previous camera device was already
removed, so final physical confirmation requires pairing it again; do not pair or
disconnect it implicitly.

The following reliability batches are also complete in the working tree. ADR 0046 adds
an eight-second WebRTC disconnect grace and counts only device-confirmed viewers, with
immediate household presence refreshes. Release `connection-reliability-20260912-2107`
is live and a real Chrome-to-Pixel TURN view remained stable until intentional exit.
ADR 0047 adds an Android battery-restriction warning/settings link and a notification
**Pause camera** action without adding a background resume path. The installed Pixel
build remained a foreground camera/microphone service and served a TURN viewer while its
Activity was backgrounded.

Validation: all 101 web tests pass, the Vite production build succeeds, ESLint and
`git diff --check` are clean, and the isolated responsive audit passes 134 captures
without page errors, unexpected API calls, horizontal overflow, or clipped controls.
Android `testDebugUnitTest` plus `assembleDebug` succeeded, and the debug APK was
update-installed on Pixel `34171JEHN07672` without clearing app data. The historical
web-only release `ui-20260912-2049` is live; `/health`, `/ready`, deployed asset hashes, and the
real Chrome rendering were verified. A rollback image was retained as
`beacon-web-rollback:ui-20260912-2049`.

## Most recent work (September 12, 2026)

The Codex continuation branch is `codex/notification-transport-v1`, created from the
detached worktree at `eb1947e` while `codex/android-experience-overhaul` remains checked
out in `C:\Dev\Beacon-SecureView`. It collects the intentional continuation spanning
the Android experience rebuild, web UI, backend maintainability boundaries,
owned-domain cutover, notification transport, and household sharing. Review branch
history and `git status` before editing overlapping files.

Firebase project `beacon-view-158ad` now has Android package
`com.beaconsecureview.camera` registered and FCM HTTP v1 enabled. The downloaded
`google-services.json` is installed locally, validated, and ignored by Git. Android uses
the official Google services plugin and Firebase BoM; FCM automatic initialization remains
off until the authenticated user explicitly enables notifications. The Firebase build
passed Android unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
20:38, preserving app data. A dedicated `beacon-fcm-sender` service account now has only
the Firebase Cloud Messaging API Admin project role. Its owner-confirmed JSON key and a
separate VAPID/application-key file are in a user-private local secrets directory outside
this repository. Root-only production copies are installed on Oracle; the sender
credential is bind-mounted read-only into the backend container.

Notification Transport v1 is implemented and deployed to the Oracle private alpha
(ADR 0044): current Firebase
Installation ID registration, standards-based Web Push, session-bound subscription
lifecycle, envelope-encrypted provider identifiers, default-off per-camera preferences
and quiet hours, transactional motion outbox, bounded retry/dedup, generic payloads, and
offline/recovery transitions after the existing 90-second presence window plus a
120-second grace. Migration 0014, the notification-enabled backend, and the matching web
and service-worker build were deployed on September 12 after a fresh encrypted backup.
Health/readiness, authenticated route protection, all five tables, read-only credential
mounting, empty initial subscription/outbox state, deployed asset hashes, and clean
startup logs passed. Chrome on Windows was opted into Web Push for `Android Camera`, with
motion and offline/recovery preferences enabled. A controlled Pixel app stop/restart
produced one motion, one offline, and one recovery event; all three provider deliveries
succeeded with zero failed or pending rows, and the Pixel returned to Online. Native FCM,
unsubscribe, quiet-hours, invalidation, and lock-screen acceptance remain open. Clean
and repeated local migrations plus all 118
backend tests pass against a dedicated PostgreSQL 18 database in Ubuntu WSL, including
all 37 integration cases; Docker Desktop remained unavailable because of a protected
stale runtime socket. Android unit tests pass using the validated ignored Firebase client
configuration copied through the repository installer. The current production-targeted
debug build passed unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
15:01 on September 12, preserving app data; it launches in camera mode, reports online,
and has no crash-level startup log entries. Continue from ADRs 0043–0044 and
[firebase-notifications-setup.md](firebase-notifications-setup.md).

The production domain is `https://beacon.builtbysai.com`. Cloudflare DNS, Caddy TLS,
Google OAuth redirect configuration, and Resend DNS verification are complete. The
notification backend and current web build were manually deployed from the continuation
before its later sharing work. Public SSH
is closed; use `ssh beacon-oracle` over Tailscale for administration. The tailnet now
defines `tag:ci`, restricts it to the Oracle tailnet address on TCP 22, and contains deny
tests for the Oracle web port and the maintainer's Windows SSH port. A GitHub OIDC trust
credential restricted to this repository's `production` environment, the `auth_keys`
scope, and `tag:ci` is configured, and its client ID and audience are in the GitHub
`production` environment. The private deployment workflow still awaits merge to `main`
and therefore has not run in GitHub Actions yet.

## Earlier work (September 10, 2026)

A third product/UX pass landed and deployed: PR #14, "Third product/UX pass:
camera-first simplification" (merged to `main` as `cb3b1bb`). Devices is no
longer a user-facing nav destination — one host device is presented as one
Camera, with the backend's device/camera-source split unchanged underneath.
The Live Viewer was rebuilt as a true full-bleed immersive stage (it had been
rendering as a small card in empty page background — check this doesn't
regress if `.live-shell` or `LiveVideo.tsx`'s top-level wrapper changes). An
Android Chrome tap-highlight bug on the bottom nav was fixed
(`-webkit-tap-highlight-color`). Access History now groups repeated live-view
attempts by a real server-recorded `audit_events.viewer_session_id`
(migration `0013_audit_events_viewer_session.sql`, applied to both the local
and Oracle databases) instead of guessing from timestamps.

Full write-up of what changed, what was deliberately left out, and why, is in
the session transcript and PR #14's description — not duplicated here to keep
this doc short. Known follow-ups not done in that pass:

- `CameraFlipButton` (source-switch control) is wired into Camera Settings
  but not yet into the Live Viewer or `BrowserCameraMode`'s source picker.
- The overflow menus (camera tile, Live Viewer) are keyboard-reachable but
  don't implement full ARIA menu roving-tabindex semantics.
- Visual QA this pass was real but targeted (mobile portrait/landscape,
  desktop for one fix), not the full viewport × state matrix from the
  original brief.
- Note for the next session: the `resize_window` browser tool did not
  actually resize the window in this environment (silently no-op'd); the
  working alternative was a same-origin `<iframe>` sized to the target
  viewport, injected via `javascript_tool`, with clicks/zooms targeted using
  real DOM `getBoundingClientRect()` coordinates rather than guessed pixel
  math against the outer screenshot's own (scaled) coordinate space.
- Note on migrations: this repo's `drizzle/meta/` does not keep intermediate
  snapshot JSON files, only `_journal.json` and the SQL files themselves. A
  bare `drizzle-kit generate` therefore has nothing to diff against and will
  emit a full "recreate every table" migration — hand-write the minimal
  `ALTER TABLE`/`CREATE INDEX` instead (see `0013` for the pattern), and
  never apply a freshly generated migration to a database with existing data
  without reading it first.

## Current source and deployment

- Repository: `builtbysai/Beacon-SecureView`
- Active local branch should be a new `codex/*` feature branch, never `main`.
- Pull requests target `main`; required CI must pass before merge.
- The GitHub deployment workflow is manually disabled. Use the current release-directory
  procedure in the September 25 section above until the owner explicitly changes that.
- Deployment uploads the validated source, applies migrations, restarts the backend
  and web services, and checks the local HTTPS `/health` and `/ready` endpoints.
- Canonical private-alpha URL: <https://beacon.builtbysai.com>
- Domain cutover release: `domain-20260911-153201`; the former temporary hostname is
  intentionally unsupported. Existing native installations need a canonical-domain
  build.
- Deployment details and rollback boundaries: [github-web-deployment.md](github-web-deployment.md)

> **Historical only:** the procedure below predates the release-directory deployment
> above. Do not use it; it copies source through `/opt/beacon/app` and lacks the current
> migration-schema verification path.

**In practice, every deploy this year — including September 16's — has been
done manually over SSH, not through the GitHub Actions workflow above** (that
workflow's merge/first-run status has been "still awaits" for a while; verify
current status with `gh workflow view "Deploy Beacon to Oracle"` rather than
assuming). Access is `ssh beacon-oracle` (Tailscale-only; public SSH is
closed, ADR 0045). The manual procedure, run from the repo root on whatever
commit is being shipped:

```bash
# 1. Package and ship the exact commit
git archive HEAD -o /tmp/beacon-deploy-<shorthash>.tar.gz --prefix=web-<full-hash>/
scp /tmp/beacon-deploy-<shorthash>.tar.gz beacon-oracle:/tmp/

# 2. On the VM: back up, extract, verify, swap in
ssh beacon-oracle
sudo cp -r /opt/beacon/app /opt/beacon/app.bak-$(date +%s)   # cheap undo
mkdir -p /opt/beacon/releases/web-<full-hash>
tar -xzf /tmp/beacon-deploy-<shorthash>.tar.gz -C /opt/beacon/releases/web-<full-hash> --strip-components=1
# spot-check a file you know changed is actually in the extracted tree, then:
sudo rsync -a --delete /opt/beacon/releases/web-<full-hash>/ /opt/beacon/app/

# 3. Schema changes FIRST, before touching backend/web images
cd /opt/beacon/app
sudo docker compose -f infrastructure/cloud/compose.yaml build migrate
sudo docker compose --env-file /etc/beacon/production.env \
  -f infrastructure/cloud/compose.yaml run --rm migrate
# then VERIFY — do not trust "[✓] migrations applied successfully!" alone, see
# the drizzle-kit ask above. e.g.:
sudo docker compose --env-file /etc/beacon/production.env \
  -f infrastructure/cloud/compose.yaml exec -T postgres \
  psql -U beacon -d beacon_secureview -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='<table>' AND column_name='<new_column>'"
# empty result with exit 0 means it silently did NOT apply -- run the ALTER
# TABLE by hand (the tracking row in drizzle.__drizzle_migrations will
# already exist and does not need touching, just the DDL itself)

# 4. Build and restart the app containers
sudo docker compose -f infrastructure/cloud/compose.yaml build backend web
sudo docker compose --env-file /etc/beacon/production.env \
  -f infrastructure/cloud/compose.yaml up -d --no-deps backend web

# 5. Verify
curl -sfk https://beacon.builtbysai.com/health
curl -sfk https://beacon.builtbysai.com/ready
curl -sfk https://beacon.builtbysai.com/ | grep -oE 'assets/index-[A-Za-z0-9]+\.(css|js)'
# compare against your local `pnpm --filter @beacon/web-viewer build` output hashes
sudo docker logs beacon-secureview-cloud-backend-1 --tail 50   # clean startup, no errors

# 6. Record it, clean up
echo <full-hash> | sudo tee /opt/beacon/app/DEPLOYED_COMMIT
rm -f /tmp/beacon-deploy-<shorthash>.tar.gz          # local and on beacon-oracle
```

Postgres credentials aren't env vars in your own shell — `sudo grep -E
'^POSTGRES_(USER|DB)=' /etc/beacon/production.env` on the VM if you need them
for an ad hoc `psql` (as above); passing `--env-file` to `docker compose exec`
does **not** forward those vars into the running container's shell the way it
does for `run`, so `$POSTGRES_USER` expansion inside `exec` fails silently —
use the literal values instead. This is exactly the kind of direct
production-DB write that should get explicit sign-off before running, not
just because it's good practice — the environment's own tooling will refuse
it without confirmation.

The repository does not contain production credentials. Keep application secrets
on the VM in `/etc/beacon/production.env`; GitHub's `production` environment contains
the deployment SSH values plus `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`. The legacy
`ORACLE_HOST` secret remains stored but is not read by the private-hostname workflow.
Never commit `.env` files, Android signing material, certificates, screenshots, build
output, or `.beacon-dev` artifacts.

## Local setup

Required tools:

- Node.js 22.13+ within Node 22
- pnpm 11.9.0
- Docker Desktop with Compose
- JDK 17 and Android SDK 35 for Android work

From `C:\Dev\Beacon-SecureView`:

```powershell
pnpm install --frozen-lockfile
.\Start-Beacon.ps1
```

The launcher creates ignored local configuration, starts PostgreSQL and Coturn,
applies migrations, starts the HTTPS/WSS development services, and opens the
viewer. Stop and validate with:

```powershell
.\Stop-Beacon.ps1
.\Test-Beacon.ps1
```

For focused work, use the command matrix in [local-development.md](local-development.md),
[quick-start.md](quick-start.md), and [testing-plan.md](testing-plan.md).
Android hardware testing uses the Pixel serial `34171JEHN07672`; preserve its
app data and do not clean-install without explicit approval.

## Safe continuation prompt

```text
Work in builtbysai/Beacon-SecureView from the existing working tree on
codex/android-experience-overhaul. Preserve all current uncommitted changes.
Goal: <one concrete outcome>
Scope: <files/features allowed to change>
Preserve authentication, authorization, capture visibility, privacy mode,
pairing, and media behavior unless explicitly included above.
Do not redesign unrelated pages or work on main. Create codex/<short-name>,
run relevant checks, review the diff, push the branch, and summarize risks and
manual checks needed before merge.
```

Codex and Claude can work against the same GitHub repository, but each coherent
change should have one branch and one pull request. Resolve conflicts by syncing
with `main`; do not use the old OneDrive checkout.

## Product guardrails and next work

Read [AGENTS.md](../AGENTS.md), this handoff, and [roadmap.md](roadmap.md)
before planning. Any device with a camera and internet access should
eventually be able to become a Beacon camera; Android is the current
implementation path with the most native reliability (foreground capture,
background operation), not the product's identity. Do not add or restore
Android-only framing in product copy, architecture, or docs. The product is a
responsive web viewer, Fastify/PostgreSQL backend, WebRTC signaling,
STUN/TURN, visible capture controls, privacy mode, pairing, authentication,
and media behavior. Recording, facial recognition, biometric storage,
customer-media AI training, subscriptions, ads, and cross-platform native
clients remain outside current scope.

Three UI/UX passes have now landed (responsive/design audit, deeper visual
QA, camera-first simplification — see "Most recent work" above for the
latest). Further page-by-page redesign should still be scoped explicitly
per session rather than done opportunistically; it is no longer a
categorically deferred area, but it is also not open-ended standing
permission. The most useful other open evidence work is physical Android
privacy/recovery and
media acceptance, backup-restore proof, domain/email identity, security/release
review, legal/trust review, accessibility, and capacity measurements. See N1–N9
in [roadmap.md](roadmap.md); completing a roadmap entry still requires its stated
owner approval and evidence.

## Useful file map

- `apps/web-viewer` — React/Vite viewer and PWA behavior
- `apps/backend` — Fastify API, auth, pairing, signaling, persistence
- `apps/android-camera` — Kotlin/Compose CameraX/WebRTC camera and monitor app
- `packages/shared-types` — shared contracts
- `infrastructure` — local PostgreSQL/Coturn and Oracle deployment material
- `docs/architecture.md` and `docs/threat-model.md` — runtime and security boundaries

Migrations 0015/0016 and ADR 0048 add the household-sharing authorization
foundation. Selected-household sessions,
grant-filtered inventory/signaling, source-enforced Listen, hub-enforced Talk,
admin-only household-wide reads/events, safe account deletion, immediate socket
teardown, and the web household selector are implemented locally. The full SQL
sequence applies on a clean PostgreSQL 18 database; the Windows
Drizzle/integration runner cannot currently reach that WSL-only PostgreSQL port.
The local authenticated API now implements invitation acceptance,
member/invitation inventory, per-camera grant replacement, and revocation with
audit and immediate socket teardown. Its 16-case PostgreSQL integration suite
passes through a temporary local bridge (stopped after testing). The web settings
UI implements manual-code invitation creation/acceptance, member and pending-
invitation revocation, and independent View/Listen/Talk grants. Transactional
invitation email is now deployed through Resend with manual-code fallback for local
development. Next: complete inbox/bounce evidence, physical multi-account
acceptance, and independent security review.

The web viewer now includes a manifest and service worker for installable,
background-capable notification behavior. Treat broader offline media caching as
separate scope; live camera viewing still requires the network and authenticated
backend services.
