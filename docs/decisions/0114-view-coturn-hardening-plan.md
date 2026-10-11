# ADR 0114: Plan for hardening View's TURN relay after Remote's relay is separated

- Status: Accepted for preparation (2026-10-11). Remote's cutover is complete: it runs
  `beacon-remote-turn-coturn-1` on port 3479. The live View relay is **unchanged** and keeps using Remote's
  override and entrypoint until the owner and Codex agree a restart window. The step-by-step transfer, with
  rollback, is [docs/turn-relay-transfer.md](../turn-relay-transfer.md).

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

## Findings from the local rehearsal (2026-10-11)

Run against coturn 4.13.0 at the digest the VM already runs, in throwaway local containers (details and the
caveat about `turnutils_uclient -y` are in [docs/turn-relay-transfer.md](../turn-relay-transfer.md)):

- Today's live configuration lets a client relay to a private address (F3 is real).
- The hardened configuration plus the repository entrypoint refuses private peers, while two relayed sessions
  on this one server still work. The entrypoint denies 10/8, 172.16/12 and 192.168/16 with a one-address hole
  for the container itself; `allowed-peer-ip` was not used for that.
- `no-cli` is deprecated in 4.13.0 (the CLI is off by default); it was removed from the configuration.
- `compose.yaml` pins the image digest and mounts the entrypoint from the repository, so View no longer
  depends on files in `/etc/beacon-remote/`.
