# Pre-deployment readiness

Beacon is deployed as an Oracle private alpha; broad-release readiness remains unproven.
The current status, owners and approval boundaries are in [roadmap.md](roadmap.md). This
document is the release gate for moving from LAN development to private alpha, public
beta, and general availability. Security and privacy failures block release regardless
of feature completeness.

## Current strengths

- Household-scoped authorization, CSRF protection, hashed server credentials, Android
  Keystore storage, exact WebSocket Origin checks, short-lived TURN credentials, and
  privacy-mode media shutdown are implemented and tested.
- HTTPS/WSS LAN operation, authenticated TURN, multi-viewer signaling, camera/source
  management, one-way audio, the first web-to-Android talk path, and motion metadata
  work in the development environment.
- The full local suite covers formatting, linting, strict types, web/backend tests,
  PostgreSQL integration, Android unit tests, and a debug build.
- The production JavaScript dependency audit currently reports no known vulnerabilities.

These strengths do not replace production operations or real-world acceptance.

## September 2026 implementation checkpoint

- Web Talk now keeps its existing video connection, gates outgoing audio on the
  server grant, and stops capture on interruption, cancellation, page hiding, and
  late permission results. Reconnection requires a fresh Talk action.
- Home and camera cards show privacy/access restrictions ahead of stale live state.
  Mobile navigation, focus movement, and semantic text contrast have regression
  coverage; Chrome was checked at 320 CSS pixels with 44-pixel navigation targets.
- CI now defines PostgreSQL integration, clean/repeated migration, Android unit/lint/
  debug/unsigned-release compilation, fully redacted history secret scanning, and a
  90-day retained CycloneDX SBOM artifact generated from the frozen pnpm dependency
  graph without lifecycle scripts. Production signing and populated prior-version
  migration acceptance remain. GitHub branch protection is unavailable for this private
  repository on its current plan, confirmed by the GitHub API on September 24; protect
  `main` before any public release if the hosting plan changes.
- Generic redacted scans of 20 git commits and the working source found no leaks. The
  household owner confirmed the previously exposed GitHub token was revoked on
  September 6, 2026. Keep it absent from source, logs, shell history, CI variables,
  and artifacts; this local scan cannot inspect external account settings or
  conversation history.
- Live View fullscreen retains identity and controls; playback, privacy, source-switch,
  and statistics failures have regression coverage. Activity now has household-scoped
  server filters and cursor pagination, day grouping, retries, camera navigation, and
  deletion confirmation. Retention automation remains open.
- The Activity checkpoint passed all 69 backend tests against PostgreSQL and 47 web
  tests. Its LAN browser check was blocked after the host Wi-Fi address changed while
  the development HTTPS proxy retained its previous address. No network access or
  certificate settings were changed to bypass that limitation.
- Motion ingestion now serializes authorization, cooldown checking, and insertion.
  A controlled eight-report race previously inserted eight events; it now inserts
  one. All 74 backend tests pass, including waiting reports during privacy, source
  disablement, credential revocation, and device revocation.
- Android local privacy remains paused after synchronization failure, retains pending
  pause intent across service restart, and blocks late capture callbacks. Seven new
  privacy regression tests, Android lint, debug/unsigned release builds, all 74 backend
  tests, and the full web/backend check passed locally. Physical offline/restart
  acceptance and globally versioned cross-device privacy remain unverified.
- Per-camera motion controls preserve the prior enabled/medium/30-second defaults,
  provide owner-facing enablement, sensitivity, and cooldown choices, and are enforced
  by the backend for stale device clients. The connected Pixel installed the current
  debug build, completed authenticated settings fetches, and retained its foreground
  camera service. Changing settings through a physical household-owner web session and
  physical false-positive profiling remain open, along with schedules, quiet hours,
  zones, calibration, and notifications.
- Daily per-camera quiet hours now use a strict `HH:mm` plus IANA time-zone contract.
  The backend suppresses event insertion inside the configured interval even for stale
  Android clients, and the Android detector locally pauses and resets its baseline.
  Backend unit tests, web controls, Android unit/lint, and debug/unsigned-release
  compilation passed locally. Physical boundary, daylight-saving, and stale-device
  acceptance require the configured HTTPS LAN environment and an owner session.
- Household motion metadata now defaults to 30-day retention, with owner-selectable
  1, 7, 30, and 90-day periods. Expired rows are hidden at read time and an hourly
  single-instance backend job deletes them with count-only audit evidence. The live
  deployment must apply migration `0008_motion_metadata_retention.sql` before this
  release; backup expiry and restore verification remain open.

These are bounded local improvements, not release approval. Physical audible Talk,
echo/routing, cross-network acceptance, and the production gates below remain open.

Device health now includes an authenticated Android battery/charging sample, displayed
only to the owning household. A connected Pixel sent and persisted a charging 100% sample.
The first local hot-reload briefly ran the new writer before its migration; this confirms
the release requirement that migrations run before application rollout. Temperature,
network quality, permission diagnostics, warning policy, and historical health remain open.

The Oracle private-alpha monitor now also checks backup-job freshness: a daily backup
that fails or is more than 30 hours old, and a previously completed weekly repository
check that fails or is more than nine days old, open the existing rate-limited alert
state. The deployed monitor completed successfully after installation. This detects
backup job failure but does not prove a restorable application database; scheduled
separate-database restore drills remain a release gate.

## Gate A: required before any internet-accessible alpha

1. **Exposed GitHub credential — completed by owner.** The household owner confirmed
   revocation on September 6, 2026. Continue to ensure it is absent from git history,
   logs, shell history, CI variables, and artifacts; never recreate, use, or repeat it.
2. **Choose and document the production topology.** Define the hosting provider, region,
   domain, one-instance capacity limit, PostgreSQL service, TLS termination, Android API
   origin, and TURN public addresses. Do not deploy the local Compose/Caddy configuration.
3. **Use managed secrets and trusted certificates.** Generate independent database,
   session, TURN, signing, and operational credentials; store them in a managed secret
   system; define rotation and emergency revocation; use platform-trusted TLS roots.
4. **Harden TURN.** Configure public UDP and TCP reachability, correct external/NAT
   addresses, restricted relay port ranges, private/link-local destination denial,
   allocation quotas, bandwidth limits, credential rotation, abuse alerts, and capacity
   monitoring. Validate both direct and forced-relay sessions from separate networks.
5. **Make database releases recoverable.** Use a managed PostgreSQL instance, encrypted
   backups, point-in-time recovery where available, a documented migration job, rollback
   guidance, restore drills, retention, and deletion verification. Application startup
   must not apply migrations.
6. **Add production observability.** Provide liveness and dependency-aware readiness,
   structured centralized logs with tested redaction, metrics for authentication,
   pairings, cameras, viewers, signaling outcomes, talk locks, motion ingestion, TURN,
   latency, errors, and saturation. Add actionable alerts, dashboards, request tracing,
   and an on-call/incident-response runbook without collecting media or credentials.
7. **Complete the account lifecycle.** Browser-session inventory and individual
   revocation are implemented. Require email verification; implement secure, expiring
   password reset; account export and deletion; deletion propagation to events and
   credentials; abuse controls; and user notification for sensitive account changes.
   Decide whether MFA is mandatory for beta.
8. **Create the Android release pipeline.** Replace `0.0.0` / version code `1`, configure
   protected release signing, build an Android App Bundle, enable release shrinking only
   after WebRTC/CameraX rules are verified, generate symbols/mappings, and establish staged
   rollout and rollback. Never place signing material in the repository.
9. **Publish trust documents.** Provide an accurate privacy policy, terms, support and
   deletion contacts, retention schedule, subprocessors/hosting regions, breach process,
   camera/microphone disclosures, and Play Data safety answers. Complete prominent
   in-app disclosure and consent where store policy requires it.
10. **Perform an independent security review.** Assess the web/API against OWASP ASVS and
    the Android app against MASVS, including authorization/IDOR, session handling, CSRF,
    WebSocket abuse, TURN abuse, denial of service, dependency/supply chain, Android
    backups/screenshots/logging, certificate validation, and lost-device scenarios.

## Gate B: required before public beta

1. **Finish retention operations.** Motion-metadata choice and server deletion are
   implemented. Define and test backup expiry, restore behavior, and a separate
   access-history retention policy before public beta.
2. **Finish media acceptance.** Test audible Listen and Talk, echo/feedback, Bluetooth and
   speaker routing, privacy interruption, two talkers, direct/TURN paths, packet loss,
   captive portals, Wi-Fi/cellular changes, long sessions, and permission revocation.
3. **Profile older devices.** Establish supported Android versions/devices and thresholds
   for CPU, memory, battery, heat, charging, screen-off survival, motion false positives,
   and the maximum concurrent viewer count. Enforce limits in product behavior.
4. **Load and failure test the backend.** Measure accounts, cameras, WebSockets, event
   ingestion, database connections, TURN allocations, reconnect storms, deploy restarts,
   and regional/network failures. Publish capacity assumptions and stop conditions.
5. **Close CI gaps.** Run PostgreSQL integration tests in CI, add Android unit/lint/release
   compilation, validate migrations from a clean and prior schema, generate an SBOM,
   scan dependencies and secrets, and protect the release branch/environment.
6. **Complete product-quality acceptance.** Verify Chrome, Edge, Firefox, Safari, Android
   WebView/device variants, responsive layouts, keyboard, screen reader/TalkBack, large
   fonts, contrast, reduced motion, localization readiness, offline/error states, and
   destructive-action recovery.
7. **Build user operations.** Add onboarding/support content, diagnostics export with
   redaction, status communication, incident templates, abuse reporting, account recovery
   support, and a documented escalation process.

## Gate C: required before general availability

- Prove backup restores and disaster recovery against stated recovery objectives.
- Run a production-like soak and external penetration test; close release-blocking issues.
- Establish patch SLAs, dependency ownership, vulnerability intake, and coordinated
  disclosure/security contact.
- Decide availability and scaling targets. The current in-memory signaling and rate limits
  support only a deliberately single-instance service; multiple instances require shared
  presence, signaling routing, talk locks, and rate limits. An SFU is needed only when
  measured fan-out requirements justify it.
- Complete legal, accessibility, store-review, privacy, and operational sign-off, then use
  a small staged rollout with monitored rollback criteria.

## Recommended execution order

1. Credentials, production architecture, runtime dependency patching, and threat review.
2. Account lifecycle, deletion/retention, secrets, TLS, PostgreSQL, and TURN hardening.
3. Observability, backups/restores, CI/release signing, and incident response.
4. Cross-network media, two-way audio, older-device, accessibility, and load acceptance.
5. Private alpha, remediation, public beta, external security review, then staged launch.

Do not call the service production-ready until every Gate A and Gate B item has an owner,
evidence, and explicit sign-off. General availability additionally requires Gate C.
