# Web responsive audit and release evidence

September 7, 2026. Current scope: [roadmap U1–U4](roadmap.md).

## Repeatable local check

Use the selected existing checkout on `codex/web-experience-rebuild`. Start a
loopback-only Vite server in one terminal:

```powershell
pnpm --filter @beacon/web-viewer dev --host 127.0.0.1 --port 5181 --strictPort
```

In another terminal, supply the installed Playwright module path if it is not
available through normal Node resolution. This session used the Codex bundled
Playwright and installed Microsoft Edge; no repository dependency was added.

```powershell
$env:BEACON_QA_URL = 'http://127.0.0.1:5181'
# Set BEACON_PLAYWRIGHT_MODULE to your installed Playwright package directory.
$env:BEACON_QA_CHANNEL = 'msedge'
node scripts/Test-BeaconResponsive.mjs
pnpm exec prettier --check apps/web-viewer/src scripts/Test-BeaconResponsive.mjs
pnpm exec eslint apps/web-viewer scripts/Test-BeaconResponsive.mjs
pnpm --filter @beacon/web-viewer test
pnpm --filter @beacon/web-viewer typecheck
pnpm --filter @beacon/web-viewer build
```

The harness rejects non-loopback origins, intercepts every API request with
fixtures and disables real WebSocket/media capture. It does not create accounts,
pair devices, send emails or touch production data. It fails on horizontal page
overflow, offscreen controls, page errors or unmocked API calls. It also asserts
vertical fit for ordinary auth, desktop Home/empty Home and desktop Live View.

Screenshots and a machine-readable report (including the browser version,
viewport dimensions, document dimensions and clipped controls) are in ignored
`.beacon-dev/responsive-audit/`. Review these visually as well as checking the
assertions; a scroll-width assertion does not prove legibility or accessibility.

## Coverage and results

Primary viewports: 320×740, 390×844, 768×1024, 1280×800 and 2560×1080.
Additional checks use 320×568 with enlarged type, and a 1280×500 desktop sidebar.

| Area                    | Acceptance coverage                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth                    | Google URL and local mark, visible password fallback, show/hide, register guidance, OAuth account collision, Paper/Evening, 200% root text sizing and short-screen scrolling.                                                                          |
| Household               | Home/empty Home, Cameras, Activity/error, Settings, device health and expanded settings, long camera/device names, Add camera.                                                                                                                         |
| Pairing and permissions | Public one-time pairing link, generated QR dialog, short-screen internal dialog scrolling, denied browser camera permission.                                                                                                                           |
| Monitor and Live        | Existing independent workspace tiles, all-private fixture, filters/camera picker expansion, compact surfaces and viewport-sized Live View. No media transport claim is made.                                                                           |
| Sidebar                 | Enter collapse/expand, accessible names/current page, focus tooltip, Escape dismissal, reload persistence, mobile labels with stored collapse, keyboard reachability of sign-out on short desktop windows. Unit coverage includes unavailable storage. |
| Trust and support       | Existing public Trust and contact layouts retain content/form scrolling. Legal drafts remain unpublished.                                                                                                                                              |

Measured fixes: the former 1280×800 Home document was 1282px high and Live View
1143px high. Their ordinary fixture now fits the laptop viewport. Wide placeholders
have bounded heights; long content still grows naturally. Monitor's layout selector
shares its toolbar, health is a compact summary, and reorder guidance lives with
the camera picker. Nothing hides page overflow globally. Pairing dialogs scroll
within the viewport; lists, history, filters, forms and legal text remain scrollable.

The baseline suite passed 63 tests. The auth and sidebar regressions bring the
suite to 66 tests. The final harness produced 119 screenshots with no horizontal
overflow, clipped controls, page errors or unexpected API calls.

## September 7 release result

The tested web build was deployed to the Oracle private alpha at
https://beaconapp.duckdns.org by rebuilding and recreating only the web service.
The public HTTPS response returned 200, `/ready` returned
`{"service":"backend","status":"ok"}`, and the backend, PostgreSQL and TURN
container IDs were unchanged. Publicly fetched assets matched the tested local build:

- `assets/index-BKkh7ZNg.js`:
  `f813d64729d4cc28dd03ab0352b5170f5bc8ee5b9fab5450a7565b19b7b4c2f8`
- `assets/index-BTKehMcG.css`:
  `100dd3e632f75e19ea834dce2197ca283f41e097c509f156e608e1391f333c21`

The repository-wide `Test-Beacon.ps1` gate also passed: formatting, ESLint,
TypeScript checks, 66 web tests, 95 database-backed backend tests, production
builds, Android unit tests, Android lint, a debug APK and an unsigned release APK.
The deployment preserved a remote source archive and the prior web image tag for
rollback.

## Web-only deployment procedure

Use the known Oracle SSH identity and its existing trusted host entry. Do not
print/copy protected environment files or disable SSH/TLS verification. The
deployment root is `/opt/beacon/app`; Compose lives in `infrastructure/cloud` and
reads `/etc/beacon/production.env` in place.

1. Complete the checks above and review the incremental diff against the local
   `.beacon-dev/release-ui-baseline/` snapshot. Existing uncommitted work remains.
2. Check production source hashes against the preserved baseline before replacing
   files. Upload only the reviewed web source changes; preserve a remote source
   archive and tag the currently running web image for rollback.
3. Run `docker compose --env-file /etc/beacon/production.env build web` from the
   cloud directory. Compare the image's `/srv/index.html` and asset SHA-256 values
   against the tested local build before starting it.
4. Run `docker compose --env-file /etc/beacon/production.env up -d --no-deps web`.
   No backend, PostgreSQL, TURN, migration, timer, secret, DNS or email changes.
5. Verify HTTPS `/health`, dependency-aware `/ready`, signed-out auth and fetched
   asset hashes. Verify the backend/PostgreSQL/TURN container IDs are unchanged.
   A brief web-proxy restart can interrupt active HTTP/WSS connections; media and
   physical reconnect acceptance remain separate gates.
6. If the rollout fails, restore the saved web image tag under the Compose web
   image name and recreate only web, then restore the saved web source archive.
   Never roll back database volumes for a web-only release.

## Limits and remaining human acceptance

Browser fixtures prove UI layout and control behavior, not real authentication,
camera capture, microphone routing, TURN transport, offline Android privacy or
backup recovery. Firefox/Safari, native TalkBack, OS font scaling, rotation,
split-screen, tablets/foldables and older-device performance need their own dated
evidence. OAuth account choice still needs the owner on Android. See N1–N9 in the
roadmap for owners, evidence and decisions; this web deployment is not public
release approval.
