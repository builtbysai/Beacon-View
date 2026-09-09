# ADR 0032: Account deletion and security-retention controls

Status: Accepted for the US-only, adults-only private alpha.

## Decision

An authenticated household owner may permanently delete their account only after an
explicit `DELETE` confirmation and a sign-in created within the prior ten minutes. The
operation first closes active camera sessions, then deletes the user. Existing foreign
keys cascade deletion of the owner's household, paired devices, device credentials,
pairing codes, camera sources, browser sessions, and motion metadata. The server clears
the requesting browser cookies and writes one unlinked `account_deleted` security event
containing only the request IP and event outcome.

Security/audit events are automatically deleted after 90 days by a single-instance
hourly backend job. Docker service logs use bounded local rotation (three 10 MB files
per service) and host/systemd journals are capped at 30 days, 200 MB, with 1 GB disk
reserve. Backups retain their independently encrypted snapshots under the existing 7
daily / 4 weekly / 3 monthly policy; a deletion can remain in a backup until that
snapshot expires.

## Consequences

The current private alpha has a real in-app account-deletion API and bounded audit/log
retention without claiming immediate erasure from backup history. The 10-minute
fresh-authentication window relies on the current session being created by a sign-in;
a future account-security milestone should add a dedicated reauthentication flow before
changing this to a broader public offering. Multi-instance deployments need a singleton
or database-coordinated retention worker.
