# Code review findings and remediation plan — October 9, 2026

Branch reviewed: `codex/shared-product-edge` (6eb8607). This is a targeted review
of security-relevant and operational code, not an exhaustive audit. Nothing was
changed, committed or deployed. Each finding says whether it was **confirmed**
(read in code/config) or **needs verification**. Fixes below are proposals only;
under `AGENTS.md` each needs approval and its own milestone/ADR where noted.

## What was run

| Check                                       | Result                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `lint`, `typecheck`    | Pass                                                                                            |
| Backend tests (`vitest`)                    | Pass, but 137 tests are skipped locally: PostgreSQL integration suites need `TEST_DATABASE_URL` |
| Web viewer tests                            | Pass                                                                                            |
| `pnpm build`                                | Pass; web build warns that a 581 kB chunk exceeds 500 kB                                        |
| Android, desktop, shell/infra tests, CI run | **Not run.** Android, Electron and deployed behaviour were reviewed from source/docs only       |

CI (`.github/workflows/ci.yml`) does run the PostgreSQL suites against a
disposable database, so the skips are a local-only gap, not a CI gap.

## Findings

Severity: **High** = fix before wider release; **Medium** = fix soon; **Low** = improve.

### F1 — High — Client IP is the proxy's IP, so every IP-keyed limit is global (confirmed)

`apps/backend/src/app.ts` builds Fastify without `trustProxy`; nothing in the
repo sets it. In production the backend sits behind Caddy
(`infrastructure/cloud/Caddyfile`), so `request.ip` is the Caddy container
address for every request. Consequences:

- `register:${ip}` (5/hour), `password-reset:${ip}`, `contact:${ip}` (3/hour),
  `guest-enter:${ip}`, `share-link-*:${ip}`, `mobile-google:`/`desktop-google:`
  are shared by **all users**. A handful of requests blocks new sign-ups,
  password resets and guest/share-link access for everyone.
- Login is keyed `login:${ip}:${hash(email)}` (10 per 15 min), which collapses
  to a per-email limit. Anyone can lock a known user out of password login by
  sending 10 bad attempts, and no per-source limiting remains for credential
  stuffing across many emails.
- Audit rows record the proxy IP, which weakens incident investigation.

Fix: set `trustProxy` to the Caddy hop only (a configured address/CIDR or hop
count, never `true`), confirm Caddy overwrites `X-Forwarded-For`, and add a test
that spoofed `X-Forwarded-For` from a non-proxy source is ignored. Consider a
separate per-email lock-out that does not block the legitimate owner's
already-trusted sessions.

### F2 — High — No security headers on the production web edge (confirmed)

Neither `infrastructure/cloud/Caddyfile` nor the web app's `index.html` sets
`Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options` /
`frame-ancestors`, `X-Content-Type-Options` (only on `/downloads/*`),
`Referrer-Policy` or `Permissions-Policy`. The app handles camera streams,
session cookies and guest tokens, so clickjacking of the viewer/guest pages and
the lack of a CSP backstop are real gaps. The Cast receiver at `/cast/` must be
framed by Cast and needs its own, looser policy.

Fix: add a site-wide header block (HSTS, nosniff, `frame-ancestors 'none'`,
`Referrer-Policy: no-referrer` or `same-origin`, a `Permissions-Policy` allowing
only camera/microphone for self), a CSP verified against the Vite build and
Firebase/Google sign-in, and a scoped exception for `/cast/`. Add a smoke test
to `scripts/Test-BeaconHttps.mjs`. Note the shared-edge change on this branch
(ADR 0106) imports product snippets; decide whether headers belong in the shared
block or per product.

### F3 — High — TURN relay can reach private networks (needs verification)

`infrastructure/cloud/turnserver.conf` blocks loopback and multicast peers only.
There is no `denied-peer-ip` for RFC 1918 / link-local ranges (including
`169.254.169.254` cloud metadata) and no per-user quota. Any holder of a valid
TURN credential — every signed-in viewer, device and guest-link viewer — could
ask coturn to relay to addresses on the Docker/host network such as the backend
or PostgreSQL containers. Verify against the running config and network layout
before treating as exploitable.

Fix: add `denied-peer-ip` ranges for 10/8, 172.16/12, 192.168/16, 169.254/16,
100.64/10, ::1, fc00::/7, fe80::/10 (and `allowed-peer-ip` for the camera
LAN only if a use case needs it), plus `user-quota`, `total-quota` and
`max-bps`. Test with a relay attempt to a private address from a TURN client.

### F4 — Medium — Backend container runs as root with build tooling (confirmed)

`infrastructure/cloud/Dockerfile.backend` has no `USER`, copies the whole build
stage (sources, dev dependencies, pnpm store) into the runtime image and has no
`HEALTHCHECK`. A code-execution bug would run as root with a writable image.

Fix: install with `--prod` (or `pnpm deploy`) into a clean runtime stage, run as
the `node` user, add a read-only root filesystem and `cap_drop: [ALL]` in
Compose, and add a health check using `/health`.

### F5 — Medium — Rate limiting is in-process only (confirmed)

`apps/backend/src/rate-limit.ts` keeps counters in memory. They reset on every
restart or deploy and cannot be shared by a second instance. Acceptable for the
single-VM design, but it should be a documented limitation, and F1 is the more
urgent part. If the backend is ever scaled out or restarts often, move counters
to PostgreSQL or a small shared store. Also check memory: the sweep keeps keys
for 24 hours regardless of window.

### F6 — Medium — Account enumeration through registration (confirmed)

`authentication-routes.ts` returns `409 googleAccountExists` when the email
belongs to a Google-only account and `409 Unable to create account` otherwise.
That reveals whether an email is registered and how. Login uses a dummy hash
(good), so this is the inconsistent path.

Fix: return one generic response (or a generic "check your email" flow) and
deliver the Google hint through email. Needs a product decision because the
current message is a deliberate usability choice.

### F7 — Medium — Android release is not shippable yet (confirmed, already tracked as N6)

`apps/android-camera/app/build.gradle.kts` has `versionCode = 1`,
`versionName = "0.0.0"`, and the `release` build type sets no signing config and
no `isMinifyEnabled` / resource shrinking. The Play account is still in identity
verification. Treat as the release gate it is: versioning scheme, signing
(Play App Signing), R8 rules, AAB build in CI, and a staged-rollout/rollback
plan. Do not buy certificates or enrol signing without owner approval.

### F8 — Medium — Very large source files raise regression risk (confirmed)

`BeaconApi.kt` (1,861 lines), `App.tsx` (1,807), `LiveVideo.tsx` (1,361),
`HouseholdSharingSettings.tsx` (1,332), `BrowserCameraMode.tsx` (1,186),
backend `store.ts` (1,128) and `recording-routes.ts` (1,121). The handoff already
notes `MonitorHomeState` should become a view model. These files mix concerns and
make reviews and focused tests harder.

Fix (incremental, each behind existing tests): split `BeaconApi.kt` by domain,
extract route groups and hooks from `App.tsx` and `LiveVideo.tsx`, and split
`store.ts` along the existing repository files. No behaviour change per step.

### F9 — Low — Web bundle is large for older devices (confirmed)

Main chunk 581 kB (164 kB gzip) plus a 478 kB `esm` chunk. Product priority 4 is
efficient operation on older devices. Lazy-load rarely used screens (settings,
sharing, recordings, Cast, browser-camera mode) and set an explicit chunk budget
in the build so growth is noticed.

### F10 — Low — Guest cookie outlives the link (confirmed)

`guest-routes.ts` sets the guest cookie for 30 days regardless of
`expiresAt`. Server-side validation rejects expired links and clears the cookie
on the next call, so this is hygiene only. Set `maxAge` to the remaining link
lifetime.

### F11 — Low — Service worker cache is not versioned per release (confirmed)

`apps/web-viewer/public/sw.js` uses a fixed `beacon-shell-v1` cache. Hashed assets
make this safe today, but stale `/icons/*` and an old shell are only evicted when
someone remembers to bump the constant. Stamp the cache name from the build.

### F12 — Low — Documentation drift and sprawl (confirmed)

`docs/` holds ~50 top-level documents, many dated handoffs and overlapping
plans. `docs/project-review-2026-10-09.md` lists roadmap rows still marked
"Planned" for implemented items and ADR 0097 wording that says video comes from
the server. Reconcile the roadmap, ADR 0097, and fold superseded handoffs into
an archive folder so there is one current source of truth. The workspace also
contains an untracked `.codex-remote-attachments/` directory that should be
gitignored or removed.

### F13 — Low — Cleartext TURN URLs (needs product decision)

Config defaults and production use `turn:` rather than `turns:`. Media is
DTLS-SRTP encrypted end to end, so this is not a media leak, but TURN allocation
metadata and credentials travel unencrypted. Consider `turns:` on 443/5349 with
the existing certificate, which also helps restrictive networks.

## Areas reviewed with no issue found

- Session and CSRF handling (`session-auth.ts`): hashed tokens, double-submit
  CSRF checked against a stored hash, origin check, httpOnly/Secure/SameSite
  cookies, absolute and idle expiry.
- Password hashing (Argon2id), constant-time secret comparison, unbiased pairing
  code generation, TURN HMAC credentials with expiry.
- Signaling WebSocket authentication and origin checks, with re-authorization
  monitoring for device connections.
- Log redaction of cookies, tokens, passwords and subscriptions.
- Android: `allowBackup=false`, cleartext traffic disabled, release API URLs must
  be HTTPS.
- Repo hygiene: build output, `.env` and Firebase configs are ignored; CI runs
  dependency audit, SBOM and secret scanning.

## Not reviewed (gaps in this review)

Recording/Drive encryption design, notification crypto, the Electron main
process and auto-update trust, Android capture/privacy-mode code paths,
migrations, backup/restore scripts, and the physical-device acceptance items
already listed in `docs/project-review-2026-10-09.md`. These need their own pass,
ideally by the independent reviewer already planned for the N6 gate.

## Remediation plan

Each step is one small, separately approved change with its own tests; none are
started.

| Order | Work                                                                             | Findings | Size   | Validation                                                   |
| ----- | -------------------------------------------------------------------------------- | -------- | ------ | ------------------------------------------------------------ |
| 1     | `trustProxy` for the Caddy hop; test spoofed `X-Forwarded-For`; ADR              | F1       | Small  | Backend unit/integration test; check audit IPs after deploy  |
| 2     | TURN `denied-peer-ip`, quotas; relay-to-private-address test                     | F3       | Small  | `scripts/Test-BeaconTurnRelay.ps1` plus a denied-peer check  |
| 3     | Security headers and CSP (report-only first), `/cast/` exception                 | F2       | Medium | `Test-BeaconHttps.mjs`; browser console check for violations |
| 4     | Backend image: prod-only deps, non-root, health check, Compose hardening         | F4       | Small  | Image build, `/ready`, restart and rollback rehearsal        |
| 5     | Guest cookie `maxAge`; generic registration response if approved                 | F10, F6  | Small  | Auth and guest integration tests                             |
| 6     | Rate-limit limitations documented; revisit if scaling out                        | F5       | Small  | Docs only unless scaling                                     |
| 7     | Android release readiness: versioning, signing, R8, AAB in CI, rollback plan     | F7       | Large  | Owner-gated; needs Play account and independent review       |
| 8     | Bundle splitting and chunk budget; SW cache versioning                           | F9, F11  | Medium | Web tests, build size check, older-device check              |
| 9     | Incremental file splits (`BeaconApi.kt`, `App.tsx`, `LiveVideo.tsx`, `store.ts`) | F8       | Large  | Existing suites unchanged; one file per PR                   |
| 10    | Docs reconciliation and archive; ignore `.codex-remote-attachments/`             | F12      | Small  | Link check, roadmap/ADR consistency                          |
| 11    | `turns:` evaluation                                                              | F13      | Small  | Needs decision; test on restrictive networks                 |

Steps 1–4 are the ones to do before any wider release. Steps 1 and 2 are
independent of the Cast/Play registration work and can proceed in parallel with it.

## Decisions needed from the owner

1. Approve steps 1–4 as the next hardening milestone.
2. Accept the generic-registration-response trade-off (F6) or keep the current hint.
3. Decide whether security headers belong in the shared product edge (ADR 0106) or per product.
4. Decide whether to pursue `turns:` (F13).
