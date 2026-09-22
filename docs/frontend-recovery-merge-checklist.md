# Frontend recovery merge checklist

Use this before merging `antigravity/recovery-checkpoint` with backend work.

## Required checks

- [ ] Install dependencies from a clean checkout.
- [ ] Run the web viewer typecheck.
- [ ] Run the web viewer test suite.
- [ ] Run the production web build.
- [ ] Run repository CI checks that cover touched frontend code.
- [ ] Verify Home, Cameras, Activity, Settings and Add Camera at 100% zoom.
- [ ] Verify desktop, laptop, tablet and narrow-phone widths without horizontal overflow.
- [ ] Verify all dialogs/sheets restore focus and do not shift the app layout.
- [ ] Verify Camera Settings opens contextually over its trigger page once issue #19 is completed.
- [ ] Confirm development-only Live Viewer fixtures/simulation cannot be exposed in production.
- [ ] Complete physical-device Live Viewer QA tracked in issue #21.
- [ ] Reconcile expanded Activity event metadata when issue #20 is implemented.

## Public/account routes

- [ ] Sign in / account creation
- [ ] Trust & privacy
- [ ] Contact / deletion flow
- [ ] Password reset: invalid, form, error, busy, success
- [ ] Email verification: pending, confirmed, failed
- [ ] Pair link: valid and invalid
- [ ] Mobile auth return: normal, link-required, failed
- [ ] Guest link: connecting, invalid, empty, picker, live view

## Camera/device flows

- [ ] Add Android camera / pairing dialog
- [ ] Browser Camera Mode permission denied / no camera / configured / broadcasting / stopped
- [ ] Camera reconnect and troubleshooting
- [ ] Privacy mode
- [ ] Motion settings
- [ ] Remove/leave device
- [ ] Multi-source camera switching

## Settings flows

- [ ] Household switching and role display
- [ ] Notification permission and per-camera preferences
- [ ] Invite, join and member camera permissions
- [ ] Motion retention and Google Drive states
- [ ] Browser sessions / revoke / access history
- [ ] Email verification and password sign-in method states
- [ ] Delete account
- [ ] Trust & privacy link

## Notes

Do not treat this checklist as evidence that a check passed. Mark items only after running them against the integrated branch/environment.
