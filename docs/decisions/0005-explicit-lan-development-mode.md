# ADR 0005: Explicit LAN development mode

- Status: accepted
- Date: 2026-07-24

## Context

Emulator defaults use loopback and `10.0.2.2`. A physical Android phone cannot
reach those addresses, and independently setting Caddy, Vite, backend, Android,
and Coturn hosts is error-prone. Broad permanent bindings would unnecessarily
expose development services.

## Decision

LAN development is an explicit PowerShell-scripted mode around one validated
non-loopback IPv4 address. The script supplies exact HTTPS/WSS origins,
server-controlled LAN ICE URLs, Caddy certificate host, strict Vite/HMR
configuration, Android build endpoint, and LAN-bound TURN ports.

PostgreSQL remains loopback-only. Caddy and TURN bind to the selected address,
while backend and Vite bind broadly only within the child development
processes. Localhost and emulator defaults remain unchanged outside LAN mode.
Debug Android builds may trust user-installed CAs through `debug-overrides`;
release builds trust system CAs only and require HTTPS.

## Consequences

Developers must install the generated Caddy public root certificate and create
restricted Private-network firewall rules. Wi-Fi client isolation, managed
device CA policy, VPN routing, and Docker Desktop networking can still prevent
phone access. Generated CA exports, process state, and logs remain ignored.
These development bindings, credentials, certificates, and trust settings must
never be reused in production.
