# ADR 0114: Plan for hardening View's TURN relay after Remote's relay is separated

- Status: Proposed. Nothing in this record changes the running relay. Needs Codex's confirmation of the
  Remote split and a joint restart window (audit finding F3).

## Context

Beacon View's cloud `compose.yaml` defines a `coturn` service (image `coturn/coturn:4.6.3-r3`,
`infrastructure/cloud/turnserver.conf`). The relay actually running on the VM is different:

- It is a hand-run container of `coturn/coturn:4.13.0` named `beacon-secureview-cloud-coturn-1`, not one
  created from that compose file.
- It bind-mounts View's `turnserver.conf` from `/opt/beacon/app/infrastructure/cloud/`, which is a copy
  of the release tree that is not updated by the manual deploy (`/opt/beacon/releases/web-<sha>`).
- It also mounts an entrypoint script and other material from `/etc/beacon-remote/`, which belong to
  Beacon Remote, and it keeps state in an unnamed Docker volume.
- Beacon View and Beacon Remote both use this one relay, so a restart or a bad option affects both.

The repository's `turnserver.conf` was hardened in this audit: private, loopback, link-local and
reserved peer ranges are denied, per-user and total quotas and a bandwidth cap are set, and the invalid
`no-loopback-peers` option was removed. **None of that is known to be live**, because the running
container reads a file that deploys do not refresh, and the audit's earlier relay smoke test failed.

## Decision

1. **Do not touch the running relay now.** Codex separates Remote's relay first. View waits for that
   to be reported finished.
2. **After the split, View gets a relay of its own**, with these properties (View-side work only):
   - defined in View's `compose.yaml`, with a pinned image tag matching what is run, so a rebuild
     reproduces production;
   - its config file comes from the deployed release directory, not `/opt/beacon/app`;
   - its own shared secret, realm and relay port range, distinct from Remote's, so that neither product's
     credentials work on the other's relay;
   - no mounts from `/etc/beacon-remote/` and a named volume.
     A shared instance is the fallback only if Codex needs it; then one compose project must own it and both
     projects must change it together.
3. **Apply the hardened settings** already in `turnserver.conf` (denied peer ranges, quotas, bandwidth
   cap, no invalid options) at the same restart.
4. **Prove it before calling it done** (the audit's open V21 test):
   - from a phone on cellular and a viewer on another network, force relay-only
     (`iceTransportPolicy` relay) and keep a live view running longer than
     `TURN_CREDENTIAL_TTL_SECONDS` while changing networks once, which exercises the ICE restart added in
     ADR 0112;
   - confirm from the relay log that allocations to a private address (for example `10.x`, `192.168.x`,
     `169.254.x`) are refused;
   - confirm the other product's credential is rejected.

## Coordination and restart window

- A relay restart drops every relayed live view for the products on it. Direct (non-relayed) sessions
  are unaffected and reconnect by themselves; relayed views reconnect through the bounded retry
  (ADR 0112 and V29), usually within seconds.
- Pick a low-use window together with Codex and the owner, announce it, restart View's relay only, and keep
  the previous container stopped but not removed until the proof in step 4 passes, so rollback is a
  start command.
- Take no action on `beacon-remote-*` containers, files, secrets or ports.

## Consequences

- Until this is done, F3 stays open, and the audit status must keep saying "config changed, not proven".
- Separate secrets mean View's backend gets a new `TURN_SHARED_SECRET` value in
  `/etc/beacon/production.env`; the backend must restart with it at the same time as the relay.
- If Codex keeps Remote on the old relay, that relay should stop reading View's files, so a View deploy
  cannot change Remote's relay.
