# ADR 0045: Administer the Oracle VM over a private Tailscale network

Status: Implemented for the Oracle private alpha on September 12, 2026.

## Context

The original Oracle staging design allowed SSH only from the owner's current
public IPv4 address. That failed whenever the administrator changed Wi-Fi and
encouraged repeated edits to OCI and host firewall rules. Investigation also
found a persistent blanket TCP 22 iptables rule ahead of UFW, so the intended
source restriction was not effective at the host layer.

## Decision

- Join the Windows administration device and `beacon-secureview-oracle` VM to the
  owner's Tailscale tailnet and use the stable private hostname for SSH.
- Keep ordinary OpenSSH public-key authentication over the private route. Do not
  enable Tailscale SSH yet; possession of the tailnet identity alone must not
  replace the existing SSH-key check.
- Start the Tailscale service automatically on both devices.
- GitHub-hosted deployment runners join as ephemeral `tag:ci` nodes through
  workload identity federation. Tailnet policy limits that tag to the VM's SSH
  port; no reusable Tailscale auth key or OAuth client secret is stored in GitHub.
- Remove TCP 22 ingress from the Oracle network security group, UFW, and the
  persistent raw iptables rules file. Keep the public web and bounded TURN rules
  unchanged.
- Do not require inbound UDP 41641. Direct connections may use it when available,
  while Tailscale's relay path remains the fallback across restrictive networks.
- Retain the VM's pre-change iptables file as a root-owned recovery artifact and
  periodically review tailnet devices and key expiry.

## Consequences

Administrative SSH no longer depends on a home public IP and is not exposed on
the VM's public interface. Both endpoints must be signed into the same authorized
tailnet, and the administrator must still possess the SSH private key. Access now
depends on Tailscale's coordination service and local clients; loss of that path
requires a deliberately temporary OCI console or narrowly scoped firewall
recovery procedure. This decision changes only administrative access and does not
route public Beacon application or TURN traffic through Tailscale.
