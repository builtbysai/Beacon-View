# ADR 0011: Idempotent Windows developer entry points

## Status

Accepted for post-Milestone-9 stabilization.

## Context

Beacon's secure LAN, TURN, process-ownership, Android installation, and
acceptance scripts were individually capable but required developers to know a
long setup sequence. First-run environment creation, dependency installation,
database migration, and the dedicated integration database were separate manual
operations. This made ordinary startup slower and made it easy to omit a
validation layer.

## Decision

Keep the existing focused scripts as implementation primitives and add three
top-level PowerShell entry points:

- `Start-Beacon.ps1` initializes and starts secure LAN development, then opens
  the dashboard and optionally installs Android.
- `Stop-Beacon.ps1` stops only repository-owned processes and Compose services.
- `Test-Beacon.ps1` runs TypeScript validation, guarded PostgreSQL integration
  tests, and Android validation.

Initialization creates a local environment file only when absent, installs with
lockfile enforcement, waits for PostgreSQL health, and applies explicit
migrations. The full validator creates only the fixed
`beacon_secureview_test` database and still relies on the backend's independent
`NODE_ENV=test`, `_test` suffix, forbidden-name, and development-URL inequality
guards before destructive setup.

## Consequences

Windows development has one obvious start, stop, and test command without
removing lower-level control. Docker Desktop remains a required external tool;
the initializer attempts to launch a standard installation and fails with
guidance when the engine remains unavailable. Production deployment behavior is
unchanged, and the scripts never modify or reset production infrastructure.
