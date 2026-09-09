# ADR 0012: Account-native camera enrollment

## Context

Beacon viewers authenticate as household users, while an Android phone acting
as an unattended camera needs narrower authority. A user suggested replacing
pairing with account sign-in after removal and re-enrollment failures. Current
consumer surveillance products generally make setup begin inside a signed-in
account, but still require a deliberate device enrollment gesture such as a QR
scan, setup button, Bluetooth exchange, or temporary device network.

## Decision

Keep household account authentication and camera credentials separate. The
signed-in owner starts one Add Camera flow and creates a short-lived,
single-use enrollment. QR scanning is the primary path and manual entry is the
fallback. Successful enrollment appears automatically in the owner's current
location. Removing a camera deletes its server registration, ends streams, and
causes Android to discard only its device credential and return to Add Camera.

Do not put a reusable household email/password or full viewer session on an
unattended camera device. A future combined Android application may offer both
viewer and camera modes, but entering camera mode must still mint a scoped
device credential through explicit owner authorization.

## Consequences

- A stolen camera credential cannot browse cameras or administer the household.
- Removal reliably releases ownership and permits the same installation to be
  enrolled again.
- Users experience setup as part of their account even though the camera uses a
  purpose-limited credential internally.
- QR failure messages must distinguish expired/used codes, throttling, and
  network failure without exposing sensitive account details.
