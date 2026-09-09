# Web responsive audit and release evidence

September 8, 2026. Current scope: [roadmap U1–U4](roadmap.md).

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
Ordinary auth cards must have no internal scrollbar. Pairing must use a native
modal dialog, contain keyboard focus and leave the page behind it inert.

Screenshots and a machine-readable report (including the browser version,
viewport dimensions, document dimensions and clipped controls) are in ignored
`.beacon-dev/responsive-audit/`. Review these visually as well as checking the
assertions; a scroll-width assertion does not prove legibility or accessibility.

## Coverage and results

Primary viewports: 320×740, 390×844, 768×1024, 1280×800 and 2560×1080.
Additional checks use 320×568 with enlarged type, and a 1280×500 desktop sidebar.

| Area                    | Acceptance coverage                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                    | Split desktop landing and compact mobile card, supplied Beacon mark, Google URL, visible password fallback, show/hide, honest reset availability, register guidance, OAuth account collision, Paper/Evening, 200% root text sizing and short-screen scrolling. |
| Household               | Home/empty Home, Cameras, Activity/error, Settings, device health and expanded settings, state-specific offline/privacy recovery, long camera/device names, Add camera.                                                                                        |
| Pairing and permissions | Public one-time pairing link, generated QR dialog, short-screen internal dialog scrolling, denied browser camera permission.                                                                                                                                   |
| Monitor and Live        | Existing independent workspace tiles, all-private fixture, filters/camera picker expansion, compact surfaces and viewport-sized Live View. No media transport claim is made.                                                                                   |
| Sidebar                 | Enter collapse/expand, accessible names/current page, focus tooltip, Escape dismissal, reload persistence, mobile labels with stored collapse, keyboard reachability of sign-out on short desktop windows. Unit coverage includes unavailable storage.         |
| Trust and support       | Existing public Trust and contact layouts retain content/form scrolling. Legal drafts remain unpublished.                                                                                                                                                      |

Measured fixes: the former 1280×800 Home document was 1282px high and Live View
1143px high. Their ordinary fixture now fits the laptop viewport. Wide placeholders
have bounded heights; long content still grows naturally. Monitor's layout selector
shares its toolbar, health is a compact summary, and reorder guidance lives with
the camera picker. Nothing hides page overflow globally. Pairing dialogs scroll
within the viewport; lists, history, filters, forms and legal text remain scrollable.

The baseline suite passed 63 tests. Auth, sidebar, modal and state-specific device
coverage raise it to 72. The final harness produced 133
screenshots with no horizontal overflow, clipped controls, page errors or unexpected
API calls.

## September 8 visual review

Gemini's screenshot observations were checked against rendered pages and measured
layouts rather than accepted from the stitched images alone.

| Observation                            | Result and change                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile navigation overlap              | The apparent overlap was largely a full-page screenshot artifact: the fixed navigation is repeated during stitching. The harness now measures the final content edge against the navigation at 320px and 390px, and defensive bottom space was increased. Both sizes clear the bar. |
| Oversized Back to cameras              | Confirmed on narrow device details. It is now a compact back-arrow action in the page header.                                                                                                                                                                                       |
| Add camera below the title             | Confirmed. Mobile uses a 44×44 top-right add action; its measured size is enforced by the harness.                                                                                                                                                                                  |
| Keep this camera ready looked disabled | Confirmed. Guidance is now an outlined disclosure with a chevron and clear expanded state.                                                                                                                                                                                          |
| Privacy action looked orphaned         | The action controls the whole Android device, not one camera source, so moving it into a source card would misstate its scope. It now sits in a labeled Device privacy group directly above Camera sources.                                                                         |
| Dense recovery copy                    | Confirmed. Each state leads with one short sentence and keeps steps in a Troubleshoot or Readiness tips disclosure.                                                                                                                                                                 |
| Repeated names and statuses            | Confirmed for status text and reduced to one card badge plus one short explanation. Device and source names remain where both identities are needed.                                                                                                                                |
| Sidebar clutter                        | Confirmed. Private alpha, household helper copy and promotional copy were removed. The rail now uses a small edge chevron, compact lighthouse mark, concise navigation and a quiet account footer.                                                                                  |
| Empty video dead space                 | Confirmed. Unavailable previews are shorter and use a larger proportional camera icon.                                                                                                                                                                                              |

The local real-account path was also exercised in Microsoft Edge against the Pixel:
sign-in, Home, device details, privacy state and WebRTC playback all completed. The
browser decoded a 240×320 stream (`readyState=4`), and the live surface now keeps its
starting overlay until the first media frame instead of treating peer connection as
visible video.

## September 8 physical Android evidence

A Pixel 7a running Android was clean-installed and exercised in portrait and
landscape through manual pairing, QR scanner launch/cancel, Camera permission,
notification permission, optional microphone permission, rear/front selection,
privacy on/off, browser viewing, native Monitor sign-in and native live viewing.

The review fixed pairing content that could be unreachable on short screens, rejected
malformed manual pairing codes before the network request, clipped the CameraX preview
to its Compose card, made privacy labels internally consistent, and made native live
controls scrollable with a compact landscape video height. Repeated native viewer
teardown exposed a WebRTC peer that was closed without disposal; disposal is now
idempotent. Viewer resource cleanup runs outside the UI thread after a reproduced ANR.
Camera and Monitor are exclusive destinations: entering Monitor immediately stops the
foreground camera service, and relaunching into Monitor cannot silently restart
capture. Four repeated Camera/Monitor switches retained the same app process with no
new crash, allocator, or ANR signature.

The updated APK now opens unpaired installations on a Welcome screen before setup.
The user chooses Set up Camera or Sign in to Monitor; setup explains where the web QR
comes from and has a direct Back action. Invalid scans identify the expected Beacon
setup link rather than reporting only a generic QR failure. On the Pixel 7a, Welcome,
Welcome → setup, setup → Back and Welcome → Monitor were exercised. Portrait and
landscape controls remained reachable; the 2400×1080 Welcome screen measured all
content through its final disclosure inside the viewport with no active scroll range.
The final debug APK was installed as a data-preserving update.

## September 7 release result

The tested web build was deployed to the Oracle private alpha at
https://beaconapp.duckdns.org by rebuilding and recreating only the web service.
The public HTTPS response returned 200, `/ready` returned
`{"service":"backend","status":"ok"}`, and the backend, PostgreSQL and TURN
container IDs were unchanged. Publicly fetched assets matched the tested local build:

- `index.html`:
  `b8bbc74cb600c939af5b0f531b286d902981988b90131f3f759c9a2318edd17e`
- `assets/index-DOKtLkC3.js`:
  `1b92af672379e6d4128d93c77e9f06d7b4ea64d6f11ee655e7edbec816f3dce0`
- `assets/index-D5TKISeX.css`:
  `f92827f9ba01154fb42f4732a2b16b7996070b5bbae3135b2b1009cc9308bf14`

The repository-wide `Test-Beacon.ps1` gate also passed: formatting, ESLint,
TypeScript checks, 70 web tests, 95 database-backed backend tests, production
builds, Android unit tests, Android lint, a debug APK and an unsigned release APK.
The deployment preserved the successful rollback set under
`/opt/beacon/releases/web-a3-20260907-r2` and tagged the prior web image. An
earlier preflight-only directory is labeled `web-a3-20260907-incomplete` and is not
a valid rollback set.

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
