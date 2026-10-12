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

## Where the gates stand (October 12, 2026)

The private alpha has been internet-accessible since the Oracle deployment, so Gate A was applied as it was built. The
list below says which items are met, with where the evidence is; an item is met only when it has evidence, not because
the feature exists.

| Gate A item                     | Status                                                                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Exposed credential            | Met (owner confirmed revocation on September 6, 2026).                                                                                                                                                               |
| 2 Topology                      | Met: one Oracle VM, documented in [oracle-cloud-staging.md](oracle-cloud-staging.md).                                                                                                                                |
| 3 Secrets and certificates      | Partly: secrets live in root-only files on the VM with a documented list ([release-procedure.md](release-procedure.md)), certificates are platform-trusted; there is no managed secret system or rotation drill yet. |
| 4 TURN                          | Met in the alpha: own relay (ADR 0114, [turn-relay-transfer.md](turn-relay-transfer.md)); cross-network acceptance is still manual.                                                                                  |
| 5 Recoverable database releases | Met: encrypted off-site backups, restore drill, migration job with verification ([runbook](runbook-outage-and-recovery.md)); point-in-time recovery is not set up.                                                   |
| 6 Observability                 | Partly: monitor, alerting and a runbook; no metrics or tracing stack.                                                                                                                                                |
| 7 Account lifecycle             | Met except export and mandatory MFA (both on the [roadmap](roadmap.md)).                                                                                                                                             |
| 8 Android release pipeline      | Partly: signed sideload builds ([android-release.md](android-release.md)); no Play upload key or App Bundle in production use.                                                                                       |
| 9 Trust documents               | Open: drafts in [legal](legal/) need owner and reviewer approval.                                                                                                                                                    |
| 10 Independent security review  | Open.                                                                                                                                                                                                                |

Gates B and C are unchanged below and remain open.

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
