# October 9 audit: closure record

The audit covered Beacon View on October 9, 2026 (findings F1 to F13 and V1 to V90). It was worked through over the
following days and closed on October 12 (ADR 0120). The original 860-line document is in git history. This page keeps
what is still useful: what was done and what was knowingly left.

## Fixed and deployed

Everything else in the audit was fixed, merged and deployed. The decisions are in these ADRs:

| Area                                                                                        | ADR        |
| ------------------------------------------------------------------------------------------- | ---------- |
| Security hardening: rate limits, trusted proxy ranges, sessions, viewer caps, push, headers | 0108, 0109 |
| Signed desktop update feed                                                                  | 0110       |
| Verified email before first sign-in                                                         | 0111       |
| ICE restart for dropped live connections, and what was deliberately left                    | 0112       |
| Device credential rotation, Android snapshots, video quality                                | 0113       |
| TURN relay under Beacon View's control, hardened and proven across networks                 | 0114       |
| Clips: chunked authenticated format, upload retry, cache hygiene                            | 0115       |
| Drive expiry reminders                                                                      | 0116       |
| Add a device flow, downloads, one update manager, standby cameras                           | 0117, 0118 |
| Public repository review                                                                    | 0119       |

Also fixed in the last pass (ADR 0120): **V50** (a "turn it back on" reminder after a restart), **V79** (Activity paging
across two feeds), **F2** (`object-src` and `base-uri` enforced in the content-security policy).

## Partly fixed

- **V61 motion detection.** Whole-picture brightness shifts and rotation no longer cause alerts. Block averaging, a
  background model and a sustained-motion filter need false-alert and miss counts from real cameras before tuning.
- **F2 content-security policy.** The wider policy is report-only (clips go from the browser to Google Drive and the Cast
  sender loads Google scripts). Enforce it after a pass over those flows on real devices.

## Closed without a change

| Finding                                          | Why                                                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5, V14, V58 in-process limits and handoff codes | Correct while one backend instance runs, which is the design (ADR 0112). Move them to PostgreSQL before a second instance.                               |
| V35, V36, V37, F8 large files, store boilerplate | Refactors with no user-visible change; split when a file is next touched (AGENTS.md: no abstractions for their own sake).                                |
| V11 backups exclude keys                         | By design: keys never sit next to the data they protect. Keeping them is the owner's routine ([runbook](runbook-outage-and-recovery.md), section 5).     |
| V34 guest access length                          | A guest's access ends with the invitation window the inviter chose (up to 48 hours by default). A stored duration needs a schema change for little gain. |
| F13 cleartext `turn:` URLs                       | Media is DTLS-SRTP encrypted end to end; the relay sees ciphertext and short-lived credentials.                                                          |
| V13 Cast token transport                         | Accepted: view-only link, four hours, revocable. Cast is still unpublished and untested on real TVs.                                                     |
| V15, V17 stale branch, unmerged branches         | Gone: the repository has only `main`.                                                                                                                    |
| V18 swipe-away keeps the camera running          | By design, with the notification and privacy gate. Keep the "swipe away, then privacy on" device test.                                                   |
| V54 desktop camera grant                         | Accepted given the enforced `object-src`/`base-uri` and the report-only policy; the desktop only loads the app origin.                                   |
| V85 snapshot file names                          | The person saves the snapshot on purpose and the name helps them find it.                                                                                |
| V28, V55, V82, V83                               | Already fixed in code (inviter named in invitations, reconnect jitter, keyboard types, tolerant motion settings).                                        |

## Still waiting on a device or the owner

These were fixed in code but not proven on hardware: the ICE restart after a dropped connection (V21, V65), the new
live viewer on a phone, the Android add-device flow and update card, and everything in the roadmap's "Open" table.
