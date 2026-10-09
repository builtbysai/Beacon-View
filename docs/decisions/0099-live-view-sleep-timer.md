# ADR 0099: Live-view sleep timer

Status: Accepted — owner requested continuing development on October 9, 2026,
after the saved camera groups/layout milestone. This is the next single bounded
convenience milestone.

## Decision

Full web/desktop live views offer Off, 15, 30 or 60 minutes. The deadline starts
when selected and can be replaced/cancelled before expiry. At expiry the viewer
disables its existing media session, closing signaling/peer transport and Talk,
muting and detaching video, exiting PiP and stopping its Cast session. In-progress
manual recording reports an intentional timer-stop failure; already encrypted
uploads retain their existing lifecycle. Resume viewing is explicit and starts
with the timer off. Camera capture/privacy settings are not changed.

The timer belongs to the mounted live player, so it follows the PiP mini-player
across page navigation. It resets on a camera switch, unmount or reload, and is
not offered on compact camera-wall/Home tiles. No native Android timer, household
automation, persisted schedules, notification worker or new permission is added.

Use a wall-clock deadline rather than counting interval ticks. Check it on focus,
page-show and visibility changes as well as periodic ticks. A suspended browser
or computer cannot execute teardown; expiry happens as soon as the page executes
again. This is a viewing convenience, not a guaranteed unattended camera shutoff.
The countdown shows whole minutes without announcing every tick to screen readers.

## Validation and limits

Tests cover initial Off, expiry, explicit resume, replacement/cancellation,
late wake, camera switching and interval cleanup. Live-player integration verifies
peer/socket teardown, disconnect signaling and no automatic reconnect after expiry.
Existing Talk and PiP suites cover the reused cleanup paths; physical Bluetooth,
microphone, PiP and Cast acceptance remain device gates. No new dependencies,
API routes, storage, migrations or recurring cost.
