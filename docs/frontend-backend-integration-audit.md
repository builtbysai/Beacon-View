# Frontend/backend integration audit

Verified September 22, 2026 on `frontend-backend-integration`. This is the
merge-readiness record for the web/PWA and backend integration. Physical Android,
media-path, provider, and network acceptance remain release evidence tracked in
the roadmap.

## Result

The frontend/backend code integration is complete. The branch preserves the
approved frontend recovery baseline while using the current backend contracts.
No later backend milestone or older backend UI variant needs to be merged into
this branch.

| Area                         | Integrated state                                                                                                                                                                                                                                                                                                 | Remaining boundary                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Home                         | `/api/cameras` and `/api/devices` provide camera and attention state. The latest preview intentionally remains motion-only. Favorites are documented as a local browser preference.                                                                                                                              | Synced favorites would require a future user preference contract.                        |
| Cameras and sources          | Listing, rename, delete, activation, privacy, pairing, reconnect, health, and source metadata use backend routes. Source sync preserves user names and treats omission as non-authoritative per ADR 0054.                                                                                                        | Physical source removal needs a future authoritative device contract.                    |
| Activity                     | The owner/admin household activity API reads structured audit events. The timeline combines those records with motion metadata. Viewer/guest motion history is filtered to currently granted camera sources. Realtime management, pairing, credential, membership, presence, and health events refresh the feed. | Household audit events remain owner/admin-only.                                          |
| Authentication and sharing   | Account, session, household switching, invitation, membership, grant, and guest flows use backend routes with household authorization.                                                                                                                                                                           | Physical multi-account evidence remains a release gate.                                  |
| Settings and notifications   | Quiet Hours, motion settings, retention, and personal owner/admin notification preferences persist through PostgreSQL. Load failures are retryable. Quiet Hours delivery and admin delivery are covered by database integration tests.                                                                           | Viewer/guest notification preferences remain intentionally outside the manager contract. |
| Optional services            | `/api/capabilities` controls Google authentication/linking, Web Push, and contact availability. Google Drive uses its specific status route. Failed capability discovery falls back to the feature endpoint's own error handling.                                                                                | Provider acceptance remains deployment-specific.                                         |
| Browser camera and live view | Browser registration, producer signaling, live WebRTC viewing, recording requests, and targeted household refresh are connected to backend contracts.                                                                                                                                                            | Cross-network direct/TURN and audio acceptance remain release evidence.                  |
| Diagnostics                  | The admin-only sanitized endpoint has a retryable frontend error state.                                                                                                                                                                                                                                          | None for code integration.                                                               |

## Decisions retained

- Household audit events remain owner/admin-only; viewers and guests can read
  motion history for their granted camera sources.
- Notification preferences are personal owner/admin settings scoped to the active
  household, as recorded in ADR 0055.
- Android source omission does not delete a source, and device sync does not
  overwrite a user display name.
- Home stays a concise current-state and recent-motion view; the complete
  household audit timeline belongs on Activity.
- The recovery tag `frontend-recovery-final-2026-09-17` remains the visual
  baseline. The recovery branch itself is not an integration dependency.

## Merge-readiness validation

The final pass completed the following checks:

- Prettier check: passed.
- ESLint: passed.
- Web typecheck and production build: passed.
- Web tests: 178 passed.
- Backend typecheck and production build: passed.
- Backend tests against the migrated dedicated PostgreSQL test database: 211
  passed with no skipped database cases.
- Database migrations: all 27 applied successfully to the dedicated test
  database.
- `git diff --check`: passed.
- Responsive smoke check: the approved landing surface rendered at 390x844,
  768x1024, and 1440x900 without horizontal document overflow. The browser
  console was clean with the local backend running.
- PWA smoke check: the manifest is linked, uses standalone display, has a start
  URL and theme color, all five icons return HTTP 200, and the service worker
  returns HTTP 200.

Android validation was intentionally omitted from this pass because the final
changes are web/PWA and backend integration changes and did not alter the Android
request/response contract.

## Remaining work after code integration

Before merging to `main`, review the aggregate branch diff and choose the desired
commit/PR merge strategy. Before broad release, complete the physical and
provider acceptance items in [roadmap.md](roadmap.md) and
[testing-plan.md](testing-plan.md), including multi-account, installed-PWA push,
direct/TURN media, audio, and real-device accessibility evidence.
