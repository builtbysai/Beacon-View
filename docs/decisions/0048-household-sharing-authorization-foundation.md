# ADR 0048: Household sharing authorization foundation

- Status: Accepted; private-alpha invitation UI implemented locally
- Date: 2026-09-13

## Context

Beacon currently models one account owning one household. Existing routes and
WebSocket/TURN authorization inherit that owner-only assumption. Adding a guest
link or copying a camera ownership check into a new route would create an
authorization bypass.

## Decision

Add explicit PostgreSQL state for `household_members`,
`household_invitations`, and `camera_grants`. Existing household owners are
backfilled as active `owner` members. Memberships have explicit active/revoked
state and optional expiry; guest memberships must have an expiry. Invitation
tokens are represented only by hashes, and invitation roles cannot be `owner`.
Camera grants are scoped to a member and source, with independent Listen and
Talk capabilities. A database trigger rejects grants whose source belongs to a
different household.

Application authorization is deny-by-default for inactive or expired members.
Owners and admins can manage household state; viewers and guests require an
explicit source grant, and cannot manage cameras or members. Admins cannot
assign owner/admin authority. The same policy must be consumed by REST reads
and mutations, event subscriptions, signaling/TURN credentials, Listen/Talk,
and revocation socket closure before invitations are exposed.

Camera-management, pairing-code, browser-device, device-credential, and
household motion-management mutations now require an active owner or admin
session through one shared session-auth guard. Household-wide diagnostics,
access history, motion history/settings, retention, and the unfiltered event
socket use the corresponding read guard. Viewer and guest camera/device lists
are grant-filtered, and signaling rechecks the same access on admission and
throughout a session.

Sessions carry their selected household and resolved membership role. The web
settings surface can switch among active memberships; switching, logout,
session revocation, membership loss, and account deletion close event and live
signaling sockets immediately. Account deletion targets only the account's
owned household even when its current session is viewing a shared household.

Listen and Talk are separate source permissions. Talk requests are denied in
the signaling hub when the grant excludes Talk. The `viewer-ready` negotiation
also carries Listen permission to the camera producer; Android omits its audio
transceiver and browser producers omit audio tracks when Listen is denied. The
viewer reflects both permissions with unavailable controls.

Ownership transfer is excluded from the first sharing release. Invitation
acceptance, revocation, expiry, denied access, and grant changes will be
audited without logging raw invitation tokens.

## Consequences

- Sharing state is durable and can be reviewed independently of route code.
- Existing owner behavior remains unchanged while selected-household sessions
  make multi-household access explicit.
- Sharing is exposed only through authenticated settings. Authorization remains
  enforced at the API, event, signaling, TURN, and media-source boundaries rather
  than relying on the interface to hide unavailable actions.
- Invitation delivery is manual in the private alpha. The raw one-time code is
  shown only at creation and must be shared through a trusted channel.

The authenticated sharing API now supports one-time invitation creation,
email-bound acceptance, pending invitation revocation, member inventory,
complete per-camera grant replacement, and member revocation. Raw tokens are
returned once for private-alpha manual delivery and only their SHA-256 hashes
are persisted. Creating another pending invitation for the same household and
email revokes the earlier one. A guest's membership expires with its invite
(one to 168 hours); longer or renewable guest access requires a later explicit
policy. Member and grant mutations close affected live/event sockets and are
audited without token or invited-email metadata. The role-aware web settings UI
supports invitation creation and acceptance, pending-invitation revocation,
member removal, and independent per-camera View, Listen, and Talk controls.
Transactional invitation email delivery is enabled when the configured Resend
sender is available; manual code delivery remains a fallback for local development.
Inbox, bounce, and complaint acceptance are still operational evidence gates.

## Validation

The focused policy and signaling suites, backend/web typechecks, Android Kotlin
compile and unit tests pass. Migrations 0015 and 0016 were applied successfully
to a clean PostgreSQL 18 test database; 0016 also backfills and constrains
session household state. Web regression coverage includes denied audio controls;
signaling coverage includes source permissions and immediate session teardown.
Web coverage includes invitation creation/acceptance and verifies that granting
Listen does not silently grant Talk.
The Windows runner reached the WSL-only PostgreSQL service through a temporary
local TCP bridge without changing PostgreSQL configuration. All 16 account and
sharing integration cases pass, including hashed invitation storage,
email-bound acceptance, grant-filtered camera access, household switching, and
session revocation. The bridge was stopped after the run and is not a developer
setup dependency.
