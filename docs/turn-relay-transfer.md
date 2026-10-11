# Moving the TURN relay fully under Beacon View (ADR 0114)

Remote now runs its own relay (`beacon-remote-turn-coturn-1`, port 3479, relay ports 49201 and up).
This is the View side of the handover. **Until the steps below are run in an agreed window, the live
View relay is unchanged**: it keeps using `/etc/beacon-remote/turn-relay.override.yaml` and
`/etc/beacon-remote/turn-relay-entrypoint.sh`.

## What changes

|                   | Today (live)                                                               | After the transfer                                                 |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Compose file      | `/opt/beacon/app/.../compose.yaml` plus Remote's override                  | the release's own `infrastructure/cloud/compose.yaml`, no override |
| Image             | `coturn/coturn:4.13.0@sha256:ad82d29a…` (override)                         | the same digest, written in `compose.yaml`                         |
| Entrypoint        | Remote's script in `/etc/beacon-remote/`                                   | `turn-relay-entrypoint.sh` in this repository                      |
| `turnserver.conf` | the old copy under `/opt/beacon/app/` (no private-range denial, no quotas) | the release's hardened copy                                        |
| Shared secret     | one secret that Remote also knew                                           | a new `TURN_SHARED_SECRET` that only View knows                    |

## What the tests showed (2026-10-11, local containers, coturn 4.13.0)

Probing used `turnutils_uclient` against a throwaway server. Note that its `-y` flag makes two clients talk
to each other through their relays and ignores `-e`, so it can only prove relay-to-relay traffic; asking for a
specific peer address needs a run without `-y`.

- With **today's live config**, a client could ask the relay to reach another private address (a container on
  the same network, or an address on a different private subnet) and the data came back. The F3 finding is real.
  (Loopback is already refused by coturn's default.)
- With the **hardened config and the repository entrypoint**, both private peers were refused.
- Two relayed sessions on this one server (a camera and a viewer that both need the relay) still work with the
  entrypoint, because it leaves one address open: the container's own. Without that hole the same pair is
  refused. coturn's `allowed-peer-ip` was tried for the hole and is not used.
- coturn 4.13.0 reports `no-cli` as deprecated; the CLI is off by default, so the line was removed.

## Before the window

1. Codex confirms nothing of Remote's uses View's relay (port 3478, the `TURN_SHARED_SECRET` value, or the
   override and entrypoint files) and that Remote's relay passed its own checks.
2. Merge and deploy the release that contains this change, so `/opt/beacon/releases/web-<sha>` has the new
   `compose.yaml`, `turnserver.conf` and `turn-relay-entrypoint.sh`. That deploy does not recreate coturn.
3. Pick a low-use window. Relayed live views drop and reconnect (a few seconds); direct views do not. Tell
   the household beforehand.

## During the window (about five minutes)

Let `R=/opt/beacon/releases/web-<sha>` and
`C="sudo docker compose --project-name beacon-secureview-cloud --env-file /etc/beacon/production.env --file $R/infrastructure/cloud/compose.yaml"`.

1. Keep the old setting for rollback:
   `sudo cp /etc/beacon/production.env /etc/beacon/production.env.before-turn-transfer`
2. Put a new random value in `TURN_SHARED_SECRET` in `/etc/beacon/production.env` (`openssl rand -hex 32`).
   Never print it in a terminal that is logged.
3. Stop the old relay: `sudo docker stop beacon-secureview-cloud-coturn-1`. Do not rename it to keep it: compose
   treats a renamed container of the same project as the service and removes it when it recreates coturn.
4. Start the new one and the backend that issues credentials for it, together:
   `$C up -d --no-deps coturn backend`
5. Check it came up: `sudo docker logs --tail 20 beacon-secureview-cloud-coturn-1` shows no errors, and
   `/ready` answers 200.
6. Prove it (Beacon View owner, two networks):
   - phone on cellular as the camera and a viewer on Wi-Fi, both forced through the relay, and a live
     view that stays up past `TURN_CREDENTIAL_TTL_SECONDS` while one side changes network once;
   - from the VM, a throwaway container on `beacon-secureview-cloud_default` that asks the relay to reach
     another private address must get no answer, while the relay's own address works.

## Rollback (any time before cleanup)

Restore the previous environment file and recreate the relay the old way (the override and entrypoint files in
`/etc/beacon-remote/` must still exist, which is why cleanup comes last):

`sudo cp /etc/beacon/production.env.before-turn-transfer /etc/beacon/production.env`, then
`sudo docker compose --project-name beacon-secureview-cloud --env-file /etc/beacon/production.env
--file /opt/beacon/app/infrastructure/cloud/compose.yaml --file /etc/beacon-remote/turn-relay.override.yaml
up -d --no-deps coturn backend`.

## Cleanup (after the proof passes)

- Ask Codex to remove `/etc/beacon-remote/turn-relay.override.yaml` and
  `/etc/beacon-remote/turn-relay-entrypoint.sh` if Remote no longer needs them.
- Delete `/etc/beacon/production.env.before-turn-transfer` (it holds the old secret).
- Mark F3 fixed in the audit only after step 6 passed.
