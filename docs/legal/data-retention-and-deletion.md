# Beacon data retention and deletion notice

Status: Draft. This document identifies implementation gaps; it must not be published
until the items marked **release blocker** are resolved.

## Current retention

| Data                                                 | Current behavior                                                                                                                                                                                                                          | Public disclosure status                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Live video and audio                                 | Not stored by Beacon. Live media is transmitted for the session only.                                                                                                                                                                     | Can disclose now.                                               |
| Motion metadata                                      | Household setting: 1, 7, 30, or 90 days; default 30. Expired rows are hidden immediately and deleted by an hourly job. A household can clear its motion history.                                                                          | Can disclose now.                                               |
| Device/camera registration data                      | Stored while the device remains paired. Deleting a device removes its registration, credentials, and camera-source data.                                                                                                                  | Can disclose now.                                               |
| Browser sessions                                     | Idle expiry after 7 days, absolute expiry after 30 days; users can revoke listed sessions.                                                                                                                                                | Can disclose now.                                               |
| Account data                                         | An authenticated owner may permanently delete the account after explicit confirmation and a sign-in within the previous 10 minutes. Household, device, camera, credential, session, pairing, and motion data are removed from production. | Available; deploy verification complete.                        |
| Security/audit events and application/container logs | Security audit events are deleted after 90 days. Docker logs use bounded rotation; host journals are capped at 30 days / 200 MB.                                                                                                          | Available; deploy verification complete.                        |
| Encrypted database backups                           | Restic policy is seven daily, four weekly, and three monthly snapshots in private Oracle Object Storage. Backup copies can retain deleted database records until snapshots expire.                                                        | Can disclose with an approved deletion/backups statement.       |
| Support correspondence                               | Retained for 24 months after the support matter is closed, then deleted or de-identified unless a legal hold or active security investigation requires longer retention.                                                                  | Approved for private alpha; publish with final contact details. |

## Required account-deletion behavior

Beacon now has an in-app deletion path and a prominent public `/account-deletion`
request path. Before Play or broad public release, add a dedicated reauthentication
flow. The deletion confirmation must plainly state what is removed, what remains for a
defined security/legal purpose, and when encrypted backup copies expire.

Recommended product behavior for approval:

1. Let an authenticated owner permanently delete their account after fresh
   authentication.
2. Immediately revoke all sessions and device credentials, disconnect active streams,
   remove account, household, device, camera, pairing-code, and motion-event data from
   production, and render deleted public identifiers unusable.
3. Retain only a narrowly scoped deletion/security record for **90 days**, unless a
   specific legal hold applies.
4. Allow encrypted backup copies to expire under the published Restic schedule; never
   restore deleted records into active production except when technically necessary for
   recovery, followed by prompt reapplication of deletions.
5. Publish the request path and a privacy contact route with the final policy.

## Owner decisions needed

- Audit/security-event retention: recommended **90 days** for private alpha, then
  automatic deletion or de-identification.
- Infrastructure/application log retention: recommended **30 days**, excluding media,
  tokens, pairing codes, and raw signaling data.
- Support correspondence retention: **approved: 24 months after closure**, unless a
  legal hold or active security investigation requires longer retention.
- Privacy-request fulfillment target: recommended acknowledgement within **7 days** and
  completion within **45 days** where applicable, subject to identity verification and
  lawful exceptions.

The 90-day audit and 30-day log controls are implemented. The final published notice
still needs the legal operator, owned-domain contact routes, and an effective date.
