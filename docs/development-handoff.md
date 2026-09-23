# Beacon SecureView development handoff

Updated September 23, 2026. This is the shortest reliable orientation for a new
development session. GitHub is canonical; the maintained local checkout is
`C:\Dev\Beacon-SecureView`.

## September 23 development data reset

At the owner's request, all application data and accounts in the Oracle PostgreSQL
`public` schema were cleared. The 27 Drizzle migration ledger rows were preserved.
All Restic snapshots were forgotten and pruned; the repository currently has zero
snapshots. The `beacon-backup.timer` and `beacon-backup-check.timer` systemd units
are disabled and inactive so the backup set remains empty during development.
Re-enable backups before relying on this VM for retained user data. OCI bucket
object versioning was not independently checked, so historical object versions
are not covered by the Restic verification.

## Read this first: check for other active work before developing

**Before planning or editing anything**, run all three of these — skipping
them previously caused a near-miss where a PR built on a stale `main` almost
overwrote unrelated, already-deployed production work:

1. `git branch -r` and `git worktree list` — this repository is worked on by
   both Codex and Claude Code sessions, sometimes concurrently in a second
   local worktree (historically `~/.codex/worktrees/<id>/Beacon-SecureView`)
   with its own uncommitted, in-progress work. If you find one, treat its
   modified files as off-limits — read them if useful for context, never
   edit, commit, or build conflicting functionality against them without
   checking with the owner first.
2. Read this file and [roadmap.md](roadmap.md) on whatever branch is
   currently checked out in any such worktree, not only on `main` — `main`
   can be, and has been, several days and many commits behind the branch
   actually running in production.
3. Check what Oracle is actually running before assuming GitHub and
   production agree: `ssh beacon-oracle` (Tailscale-only; public SSH is
   closed, see ADR 0045), then `sudo docker compose --project-name
beacon-secureview-cloud ps` and `ls -lt /opt/beacon/releases/ | head`.

## September 16: recording actually captures/uploads now (owner-scoped ask to Codex below)

The owner's ask that started this: "fix the recording and cloud recording. test
it and make sure it works", then, when asked whether to close the gap on
browser and/or Android: "Both browser side and android side. Any camera can
capture based of motion or other settings. The browser/viewer can also
manually capture. Both devices should be able to capture and upload." Commit
`314ff37` on `main` (built on top of `bce74c5`, see below) delivers that.

**What was actually broken.** Recording had never worked for the owner despite
earlier attempts. Root cause: `POST /api/recordings`'s audit-log call passed
`camera.cameraId` (the camera-_source_ id) into `store.audit({ cameraId })`,
which is FK'd to `cameras.id` (the _device_ id) — every single recording
request crashed with a 500 from the `audit_events_camera_id_fkey` violation,
before any capture logic could ever run. Fixed in `bce74c5` (one line: use
`camera.deviceId`). The rest of the HTTP lifecycle (`request` →
`upload-session` → `complete` → list/delete, plus the device-credential
variants) already worked correctly once that crash was gone — confirmed by a
new 10-case integration suite,
`apps/backend/test/recording-routes.integration.test.ts`.

Separately, and more importantly: **nothing on either platform had ever
actually captured or uploaded a clip.** The request/status state machine and
the Drive resumable-upload plumbing (`initiateDriveRecordingUpload`,
`finalizeRecordingUpload` / `verifyDriveRecordingFile`) existed from the
September 15 port (ADR 0051) but had no caller. `314ff37` closes that end to
end on both platforms:

- **Browser, manual (both viewer and browser-camera modes).** New
  `apps/web-viewer/src/recording-capture.ts` (`ClipRecorder` around
  `MediaRecorder`, `uploadClipToDrive` doing the raw `PUT` to the Drive
  session URL) and `useClipRecorder.ts` (request → capture → upload →
  complete orchestration hook, with elapsed-timer display and a
  `MAX_CLIP_DURATION_MS` auto-stop). Wired into `LiveVideo.tsx`'s existing
  record button and into a new record control in `BrowserCameraMode.tsx`
  (owner-gated). Fully tested (jsdom has neither `MediaStream` nor
  `MediaRecorder` as globals — tests stub both; production code guards
  `instanceof MediaStream` behind `typeof MediaStream !== 'undefined'` so it
  can't throw in that environment).
- **Backend, motion-triggered auto-record.** New per-camera-source
  `motion_record_enabled` column (`recordOnMotion` in the API), server-
  authoritative: the device never decides for itself, it just acts on a
  `recordingId` the server hands back in the motion-event report response
  when eligible (setting on, owner's Drive connection has the recording
  scope, no recording already in flight for that camera source) — see
  `Store.createMotionTriggeredRecording` in `store.ts` and the
  `POST /api/device/cameras/:cameraId/motion-events` handler in
  `device-runtime-routes.ts`. This piggybacks on the existing motion-report
  round trip rather than adding a new server→device signaling channel. New
  "Record a short clip when motion is detected" checkbox in
  `MotionSettingsPanel.tsx` — this UI control was _missing_ on first pass
  (schema/API shipped with no way to turn it on) and was caught by a
  read-only verification subagent, then added.
- **Android, capture + auto-record.** `CameraXVideoCapturer.kt` gained an
  optional third concurrent CameraX use case (`VideoCapture<Recorder>`,
  `QualitySelector.fromOrderedList([SD, HD], ...)`). Binding is tried with
  all three use cases first; on **any** failure it unbinds and rebinds with
  just the original two (`preview`, `imageAnalysis`) — reusing this
  codebase's own proven lens-flip unbind/rebind pattern, so hardware that
  can't support the extra stream never regresses live view. New
  `MotionClipUpload.kt` (streaming SHA-256, raw `HttpURLConnection` PUT to
  the Drive session URL). `CameraForegroundService.kt` acts on the
  `recordingId` the motion-event response returns and drives the
  upload/complete calls. `google-services`/Gradle: added
  `androidx.camera:camera-video:1.4.2`.

**Validated:** backend (`tsc -b`, `eslint`, `prettier --check`, 200/200 tests,
`build`), web-viewer (`typecheck`, `eslint`, 168/168 tests, `build`), Android
(`compileDebugKotlin`, `testDebugUnitTest`, `lintDebug`, `assembleRelease` —
all green). **Not validated:** the Android capture path has never run on
physical hardware. It builds and passes every automated gate available in
this environment, but the 3-stream CameraX bind and the `Recorder`
encoder/muxer are unverified in practice — needs the owner's Pixel
(`34171JEHN07672`, preserve app data). Also still open, deliberately not done
this pass: ADR 0051 calls for the camera to encrypt a clip before upload;
neither the browser nor Android implementation does that yet — clips upload
as plain `video/webm`/whatever `MediaRecorder`/`Recorder` produces. Flag this
before treating recording as release-ready.

**Deployed to production same session.** `314ff37` is live at
`https://beacon.builtbysai.com` (`DEPLOYED_COMMIT` updated). See the next
section — the deploy surfaced a real bug worth independent investigation.

### Ask for Codex: bug-hunt why `drizzle-kit migrate` silently no-ops

This bit twice in one session, local **and** production, and the root cause
was never found — only worked around. Sequence on production, exactly
reproducing what had already happened locally a few hours earlier: migration
`0025_motion_record_enabled.sql` (`ALTER TABLE "camera_sources" ADD COLUMN
"motion_record_enabled" boolean DEFAULT false NOT NULL;`, generated cleanly
via `drizzle-kit generate --name motion_record_enabled` against a valid
snapshot chain) was applied via
`docker compose ... run --rm migrate`, which printed:

```
[⣷] applying migrations...[✓] migrations applied successfully!
```

— and the row for migration id 25 (correct sha256 hash of the file) was
genuinely present in `drizzle.__drizzle_migrations` afterward. But the column
did not exist: `SELECT column_name FROM information_schema.columns WHERE
table_name='camera_sources' AND column_name='motion_record_enabled'` came back
empty, confirmed by direct `psql`. I.e. drizzle-kit marked the migration as
applied _without the DDL ever running against the database_ — no error, no
partial-apply warning, nothing in the tool's own output to suggest anything
was wrong. Both times, the workaround was the same: run the `ALTER TABLE`
statement by hand (the tracking row already existed, so just the DDL, nothing
else needed touching).

This is a serious trust problem for the migration tool specifically, not a
one-off typo: `db:migrate` reporting success is the only signal this project's
deploy procedure currently checks before moving on to rebuilding/restarting
the app containers. If a future migration's silent no-op leaves a column or
table missing that new code actually reads/writes on the hot path (unlike
this one, whose column had a safe default and no reader until the same
deploy's app code shipped), that's an outage, not a shrug.

Please dig into why. Starting points, none confirmed:

- Is `drizzle-kit`'s CLI actually executing the SQL file's statements inside a
  transaction/connection that then gets rolled back or discarded silently
  (e.g. a driver/pool mismatch between what `drizzle.config.ts` configures
  and what the `migrate` runner actually connects to)?
- Version pinned in `apps/backend/package.json` — is this a known upstream
  issue for that specific `drizzle-kit`/`drizzle-orm` version pair? Check
  their changelog/issue tracker.
- Does it reproduce reliably with a minimal single-statement migration against
  a clean local Postgres, or does it need the specific history/size of this
  project's migration chain to trigger?
- `docs/development-handoff.md`'s September 10 entry already flagged a
  related-but-distinct drizzle quirk (`drizzle/meta/` has no intermediate
  snapshot JSON in _some_ history, so a bare `generate` recreates every
  table) — confirm whether that's the same root cause resurfacing
  differently, or a separate issue.
- Whatever you find, the fix should make a bad apply loud (fail the command,
  or add a post-apply verification step the deploy procedure actually
  checks), not just patch this one instance quietly.

## September 14-15 merge: main is now the production line

`main` had drifted ~4 days and 16+ commits behind `codex/notification-transport-v1`,
which was the branch actually deployed to Oracle (household sharing, notification
transport, Google Drive backup foundation, camera reliability fixes, and the
Tailscale-based private deploy workflow, ADRs 0044-0050). A parallel `codex/
android-experience-overhaul` branch had independently rebuilt the same backend/
Android maintainability split with a different implementation; its genuinely new
fixes (an Android live-view reconnect that froze video, a `session!!` race that
could crash the Monitor app on session expiry, and several web-viewer bugs) were
re-applied on top of `codex/notification-transport-v1` instead of merging that
whole branch, since both had independently built the same refactor.

`codex/notification-transport-v1` (with those fixes, plus a household-invitation
resend action and negative-authorization test coverage added on top) has now been
merged into `main` and pushed, restoring `main` as the accurate source of truth.
All now-stale/fully-merged branches were deleted on GitHub and locally; only
`main`, `codex/notification-transport-v1` (kept because a Codex worktree still had
it checked out with uncommitted work), and `claude/continue-from-notification-transport-v1`
remain.

## September 15: recording foundation + FCM token fix ported from the Codex worktree

The uncommitted work described in the previous paragraph (as it stood at the
September 14-15 merge) was confirmed abandoned by the owner and has now been
ported onto `main` in two commits: a real Android bug fix (FCM push
registration was sending the Firebase Installation ID instead of the actual
messaging token, so device push could never have worked — `onNewToken`/
`messaging.token` now used throughout, backend accepts `token` with `fid` kept
only for one rollout cycle), and the full user-owned recording foundation
(migration 0018, `recording-routes.ts`, `postgres-recording-repository.ts`,
the `drive.file`-scoped recording OAuth variant in `authentication-routes.ts`/
`google-drive-client.ts`, ADR 0051, and `docs/core-feature-completion-plan.md`).
Full repo check (`format:check`, `lint`, `typecheck`, backend `test`, `build`)
and the Android gradle gates (`compileDebugKotlin`, `testDebugUnitTest`,
`lintDebug`, `assembleRelease`) all passed before committing.

Per `core-feature-completion-plan.md`'s execution order — (1) notifications/
security events, (2) household sharing completion, (3) account recovery/
hardening, (4) recording + Drive export, (5) integration/operational proof,
(6) UI/UX pass, (7) release gate — this lands step 1's token fix and most of
step 4's backend contract. Still open: step 1's security-event outbox and
native/physical FCM acceptance; step 2's remaining inbox/bounce evidence and
recording grants; step 3 (account recovery/hardening) has no implementation
yet; step 4 still needs the Android capture/upload client and the web
recording UI (intentionally deferred to step 6). The stale Codex worktree at
`~/.codex/worktrees/0235/Beacon-SecureView` still holds the now-superseded
uncommitted diff this was ported from — do not port it again; it can be
discarded once confirmed no longer needed.

## September 15 fix: automated deploy's Tailscale OIDC trust credential

The `Deploy Beacon to Oracle` workflow's `tailscale/github-action` step was
failing every run with `token exchange failed with status 403` because the
Tailscale trust credential's configured OIDC **Subject** used the classic
GitHub Actions format (`repo:builtbysai/Beacon-SecureView:environment:production`),
while this repo has `use_immutable_subject: true` set (check via `gh api
repos/builtbysai/Beacon-SecureView/actions/oidc/customization/sub`), so
GitHub actually issues tokens with org/repo IDs baked in instead:
`repo:builtbysai@37721651/Beacon-SecureView@1309277283:environment:production`.
Tailscale's edit-credential page shows exactly this mismatch under "Cannot
validate subject" — it echoes back the literal subject it received from the
last token, which is the fastest way to diagnose this class of failure again.

Fixed by updating the trust credential (Tailscale admin console → Settings →
Trust credentials → the `TV73JXogci...` OIDC credential → Edit) to the
immutable-ID subject shown above; Client ID and Audience were untouched. This
is a durable fix, not a one-off: `sub_claim_prefix` is a fixed, persistent
per-repo GitHub setting (immutable IDs never change even across repo/org
renames), so every future run against the `production` environment will keep
emitting this exact subject. It would only break again if someone
deliberately flips `use_immutable_subject` back to `false` on the repo, or if
the trust credential itself is deleted/recreated with the old-format subject
typed in again.

## September 12 interface-reliability follow-up

The owner approved a bounded follow-up after the Chrome Web Push baseline: modernize
the existing web sidebar without installing shadcn, keep the collapsed account menu's
Trust & privacy and Sign out actions reachable, restructure notification settings, and
make Android camera disconnect available whether capture is live or paused.

The web sidebar now has a sticky header/footer, independently scrollable navigation,
icon-collapse rail, `Ctrl`/`Cmd`+`B` toggle, active-state treatment, portal-rendered
tooltips, and a portal-rendered account menu that cannot be clipped by the collapsed
shell. Notification settings now separate browser delivery status from responsive
per-camera alert cards, use switch controls, expose unsaved state, and avoid redundant
saves. No component framework was added.

Android now exposes Disconnect beside Pause and in the overflow menu, confirms the
destructive action, clears the local device credential before stopping the foreground
capture service, and performs server removal as best-effort cleanup. This prevents a
network failure from leaving the phone capturing or able to restart with the old
credential. The Pixel currently reports that its previous camera device was already
removed, so final physical confirmation requires pairing it again; do not pair or
disconnect it implicitly.

The following reliability batches are also complete in the working tree. ADR 0046 adds
an eight-second WebRTC disconnect grace and counts only device-confirmed viewers, with
immediate household presence refreshes. Release `connection-reliability-20260912-2107`
is live and a real Chrome-to-Pixel TURN view remained stable until intentional exit.
ADR 0047 adds an Android battery-restriction warning/settings link and a notification
**Pause camera** action without adding a background resume path. The installed Pixel
build remained a foreground camera/microphone service and served a TURN viewer while its
Activity was backgrounded.

Validation: all 101 web tests pass, the Vite production build succeeds, ESLint and
`git diff --check` are clean, and the isolated responsive audit passes 134 captures
without page errors, unexpected API calls, horizontal overflow, or clipped controls.
Android `testDebugUnitTest` plus `assembleDebug` succeeded, and the debug APK was
update-installed on Pixel `34171JEHN07672` without clearing app data. The historical
web-only release `ui-20260912-2049` is live; `/health`, `/ready`, deployed asset hashes, and the
real Chrome rendering were verified. A rollback image was retained as
`beacon-web-rollback:ui-20260912-2049`.

## Most recent work (September 12, 2026)

The Codex continuation branch is `codex/notification-transport-v1`, created from the
detached worktree at `eb1947e` while `codex/android-experience-overhaul` remains checked
out in `C:\Dev\Beacon-SecureView`. It collects the intentional continuation spanning
the Android experience rebuild, web UI, backend maintainability boundaries,
owned-domain cutover, notification transport, and household sharing. Review branch
history and `git status` before editing overlapping files.

Firebase project `beacon-view-158ad` now has Android package
`com.beaconsecureview.camera` registered and FCM HTTP v1 enabled. The downloaded
`google-services.json` is installed locally, validated, and ignored by Git. Android uses
the official Google services plugin and Firebase BoM; FCM automatic initialization remains
off until the authenticated user explicitly enables notifications. The Firebase build
passed Android unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
20:38, preserving app data. A dedicated `beacon-fcm-sender` service account now has only
the Firebase Cloud Messaging API Admin project role. Its owner-confirmed JSON key and a
separate VAPID/application-key file are in a user-private local secrets directory outside
this repository. Root-only production copies are installed on Oracle; the sender
credential is bind-mounted read-only into the backend container.

Notification Transport v1 is implemented and deployed to the Oracle private alpha
(ADR 0044): current Firebase
Installation ID registration, standards-based Web Push, session-bound subscription
lifecycle, envelope-encrypted provider identifiers, default-off per-camera preferences
and quiet hours, transactional motion outbox, bounded retry/dedup, generic payloads, and
offline/recovery transitions after the existing 90-second presence window plus a
120-second grace. Migration 0014, the notification-enabled backend, and the matching web
and service-worker build were deployed on September 12 after a fresh encrypted backup.
Health/readiness, authenticated route protection, all five tables, read-only credential
mounting, empty initial subscription/outbox state, deployed asset hashes, and clean
startup logs passed. Chrome on Windows was opted into Web Push for `Android Camera`, with
motion and offline/recovery preferences enabled. A controlled Pixel app stop/restart
produced one motion, one offline, and one recovery event; all three provider deliveries
succeeded with zero failed or pending rows, and the Pixel returned to Online. Native FCM,
unsubscribe, quiet-hours, invalidation, and lock-screen acceptance remain open. Clean
and repeated local migrations plus all 118
backend tests pass against a dedicated PostgreSQL 18 database in Ubuntu WSL, including
all 37 integration cases; Docker Desktop remained unavailable because of a protected
stale runtime socket. Android unit tests pass using the validated ignored Firebase client
configuration copied through the repository installer. The current production-targeted
debug build passed unit tests and was update-installed on Pixel 7a `34171JEHN07672` at
15:01 on September 12, preserving app data; it launches in camera mode, reports online,
and has no crash-level startup log entries. Continue from ADRs 0043–0044 and
[firebase-notifications-setup.md](firebase-notifications-setup.md).

The production domain is `https://beacon.builtbysai.com`. Cloudflare DNS, Caddy TLS,
Google OAuth redirect configuration, and Resend DNS verification are complete. The
notification backend and current web build were manually deployed from the continuation
before its later sharing work. Public SSH
is closed; use `ssh beacon-oracle` over Tailscale for administration. The tailnet now
defines `tag:ci`, restricts it to the Oracle tailnet address on TCP 22, and contains deny
tests for the Oracle web port and the maintainer's Windows SSH port. A GitHub OIDC trust
credential restricted to this repository's `production` environment, the `auth_keys`
scope, and `tag:ci` is configured, and its client ID and audience are in the GitHub
`production` environment. The private deployment workflow still awaits merge to `main`
and therefore has not run in GitHub Actions yet.

## Earlier work (September 10, 2026)

A third product/UX pass landed and deployed: PR #14, "Third product/UX pass:
camera-first simplification" (merged to `main` as `cb3b1bb`). Devices is no
longer a user-facing nav destination — one host device is presented as one
Camera, with the backend's device/camera-source split unchanged underneath.
The Live Viewer was rebuilt as a true full-bleed immersive stage (it had been
rendering as a small card in empty page background — check this doesn't
regress if `.live-shell` or `LiveVideo.tsx`'s top-level wrapper changes). An
Android Chrome tap-highlight bug on the bottom nav was fixed
(`-webkit-tap-highlight-color`). Access History now groups repeated live-view
attempts by a real server-recorded `audit_events.viewer_session_id`
(migration `0013_audit_events_viewer_session.sql`, applied to both the local
and Oracle databases) instead of guessing from timestamps.

Full write-up of what changed, what was deliberately left out, and why, is in
the session transcript and PR #14's description — not duplicated here to keep
this doc short. Known follow-ups not done in that pass:

- `CameraFlipButton` (source-switch control) is wired into Camera Settings
  but not yet into the Live Viewer or `BrowserCameraMode`'s source picker.
- The overflow menus (camera tile, Live Viewer) are keyboard-reachable but
  don't implement full ARIA menu roving-tabindex semantics.
- Visual QA this pass was real but targeted (mobile portrait/landscape,
  desktop for one fix), not the full viewport × state matrix from the
  original brief.
- Note for the next session: the `resize_window` browser tool did not
  actually resize the window in this environment (silently no-op'd); the
  working alternative was a same-origin `<iframe>` sized to the target
  viewport, injected via `javascript_tool`, with clicks/zooms targeted using
  real DOM `getBoundingClientRect()` coordinates rather than guessed pixel
  math against the outer screenshot's own (scaled) coordinate space.
- Note on migrations: this repo's `drizzle/meta/` does not keep intermediate
  snapshot JSON files, only `_journal.json` and the SQL files themselves. A
  bare `drizzle-kit generate` therefore has nothing to diff against and will
  emit a full "recreate every table" migration — hand-write the minimal
  `ALTER TABLE`/`CREATE INDEX` instead (see `0013` for the pattern), and
  never apply a freshly generated migration to a database with existing data
  without reading it first.

## Current source and deployment

- Repository: `builtbysai/Beacon-SecureView`
- Active local branch should be a new `codex/*` feature branch, never `main`.
- Pull requests target `main`; required CI must pass before merge.
- Once the current workflow change is reviewed and merged, a successful CI run for a
  push to `main` triggers the protected `Deploy Beacon to Oracle` workflow.
- Deployment uploads the validated source, applies migrations, restarts the backend
  and web services, and checks the local HTTPS `/health` and `/ready` endpoints.
- Canonical private-alpha URL: <https://beacon.builtbysai.com>
- Domain cutover release: `domain-20260911-153201`; the former temporary hostname is
  intentionally unsupported. Existing native installations need a canonical-domain
  build.
- Deployment details and rollback boundaries: [github-web-deployment.md](github-web-deployment.md)

**In practice, every deploy this year — including September 16's — has been
done manually over SSH, not through the GitHub Actions workflow above** (that
workflow's merge/first-run status has been "still awaits" for a while; verify
current status with `gh workflow view "Deploy Beacon to Oracle"` rather than
assuming). Access is `ssh beacon-oracle` (Tailscale-only; public SSH is
closed, ADR 0045). The manual procedure, run from the repo root on whatever
commit is being shipped:

```bash
# 1. Package and ship the exact commit
git archive HEAD -o /tmp/beacon-deploy-<shorthash>.tar.gz --prefix=web-<full-hash>/
scp /tmp/beacon-deploy-<shorthash>.tar.gz beacon-oracle:/tmp/

# 2. On the VM: back up, extract, verify, swap in
ssh beacon-oracle
sudo cp -r /opt/beacon/app /opt/beacon/app.bak-$(date +%s)   # cheap undo
mkdir -p /opt/beacon/releases/web-<full-hash>
tar -xzf /tmp/beacon-deploy-<shorthash>.tar.gz -C /opt/beacon/releases/web-<full-hash> --strip-components=1
# spot-check a file you know changed is actually in the extracted tree, then:
sudo rsync -a --delete /opt/beacon/releases/web-<full-hash>/ /opt/beacon/app/

# 3. Schema changes FIRST, before touching backend/web images
cd /opt/beacon/app
sudo docker compose -f infrastructure/cloud/compose.yaml build migrate
sudo docker compose --env-file /etc/beacon/production.env \
  -f infrastructure/cloud/compose.yaml run --rm migrate
# then VERIFY — do not trust "[✓] migrations applied successfully!" alone, see
# the drizzle-kit ask above. e.g.:
sudo docker compose --env-file /etc/beacon/production.env \
  -f infrastructure/cloud/compose.yaml exec -T postgres \
  psql -U beacon -d beacon_secureview -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='<table>' AND column_name='<new_column>'"
# empty result with exit 0 means it silently did NOT apply -- run the ALTER
# TABLE by hand (the tracking row in drizzle.__drizzle_migrations will
# already exist and does not need touching, just the DDL itself)

# 4. Build and restart the app containers
sudo docker compose -f infrastructure/cloud/compose.yaml build backend web
sudo docker compose --env-file /etc/beacon/production.env \
  -f infrastructure/cloud/compose.yaml up -d --no-deps backend web

# 5. Verify
curl -sfk https://beacon.builtbysai.com/health
curl -sfk https://beacon.builtbysai.com/ready
curl -sfk https://beacon.builtbysai.com/ | grep -oE 'assets/index-[A-Za-z0-9]+\.(css|js)'
# compare against your local `pnpm --filter @beacon/web-viewer build` output hashes
sudo docker logs beacon-secureview-cloud-backend-1 --tail 50   # clean startup, no errors

# 6. Record it, clean up
echo <full-hash> | sudo tee /opt/beacon/app/DEPLOYED_COMMIT
rm -f /tmp/beacon-deploy-<shorthash>.tar.gz          # local and on beacon-oracle
```

Postgres credentials aren't env vars in your own shell — `sudo grep -E
'^POSTGRES_(USER|DB)=' /etc/beacon/production.env` on the VM if you need them
for an ad hoc `psql` (as above); passing `--env-file` to `docker compose exec`
does **not** forward those vars into the running container's shell the way it
does for `run`, so `$POSTGRES_USER` expansion inside `exec` fails silently —
use the literal values instead. This is exactly the kind of direct
production-DB write that should get explicit sign-off before running, not
just because it's good practice — the environment's own tooling will refuse
it without confirmation.

The repository does not contain production credentials. Keep application secrets
on the VM in `/etc/beacon/production.env`; GitHub's `production` environment contains
the deployment SSH values plus `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`. The legacy
`ORACLE_HOST` secret remains stored but is not read by the private-hostname workflow.
Never commit `.env` files, Android signing material, certificates, screenshots, build
output, or `.beacon-dev` artifacts.

## Local setup

Required tools:

- Node.js 22.13+ within Node 22
- pnpm 11.9.0
- Docker Desktop with Compose
- JDK 17 and Android SDK 35 for Android work

From `C:\Dev\Beacon-SecureView`:

```powershell
pnpm install --frozen-lockfile
.\Start-Beacon.ps1
```

The launcher creates ignored local configuration, starts PostgreSQL and Coturn,
applies migrations, starts the HTTPS/WSS development services, and opens the
viewer. Stop and validate with:

```powershell
.\Stop-Beacon.ps1
.\Test-Beacon.ps1
```

For focused work, use the command matrix in [local-development.md](local-development.md),
[quick-start.md](quick-start.md), and [testing-plan.md](testing-plan.md).
Android hardware testing uses the Pixel serial `34171JEHN07672`; preserve its
app data and do not clean-install without explicit approval.

## Safe continuation prompt

```text
Work in builtbysai/Beacon-SecureView from the existing working tree on
codex/android-experience-overhaul. Preserve all current uncommitted changes.
Goal: <one concrete outcome>
Scope: <files/features allowed to change>
Preserve authentication, authorization, capture visibility, privacy mode,
pairing, and media behavior unless explicitly included above.
Do not redesign unrelated pages or work on main. Create codex/<short-name>,
run relevant checks, review the diff, push the branch, and summarize risks and
manual checks needed before merge.
```

Codex and Claude can work against the same GitHub repository, but each coherent
change should have one branch and one pull request. Resolve conflicts by syncing
with `main`; do not use the old OneDrive checkout.

## Product guardrails and next work

Read [AGENTS.md](../AGENTS.md), this handoff, and [roadmap.md](roadmap.md)
before planning. Any device with a camera and internet access should
eventually be able to become a Beacon camera; Android is the current
implementation path with the most native reliability (foreground capture,
background operation), not the product's identity. Do not add or restore
Android-only framing in product copy, architecture, or docs. The product is a
responsive web viewer, Fastify/PostgreSQL backend, WebRTC signaling,
STUN/TURN, visible capture controls, privacy mode, pairing, authentication,
and media behavior. Recording, facial recognition, biometric storage,
customer-media AI training, subscriptions, ads, and cross-platform native
clients remain outside current scope.

Three UI/UX passes have now landed (responsive/design audit, deeper visual
QA, camera-first simplification — see "Most recent work" above for the
latest). Further page-by-page redesign should still be scoped explicitly
per session rather than done opportunistically; it is no longer a
categorically deferred area, but it is also not open-ended standing
permission. The most useful other open evidence work is physical Android
privacy/recovery and
media acceptance, backup-restore proof, domain/email identity, security/release
review, legal/trust review, accessibility, and capacity measurements. See N1–N9
in [roadmap.md](roadmap.md); completing a roadmap entry still requires its stated
owner approval and evidence.

## Useful file map

- `apps/web-viewer` — React/Vite viewer and PWA behavior
- `apps/backend` — Fastify API, auth, pairing, signaling, persistence
- `apps/android-camera` — Kotlin/Compose CameraX/WebRTC camera and monitor app
- `packages/shared-types` — shared contracts
- `infrastructure` — local PostgreSQL/Coturn and Oracle deployment material
- `docs/architecture.md` and `docs/threat-model.md` — runtime and security boundaries

Migrations 0015/0016 and ADR 0048 add the household-sharing authorization
foundation. Selected-household sessions,
grant-filtered inventory/signaling, source-enforced Listen, hub-enforced Talk,
admin-only household-wide reads/events, safe account deletion, immediate socket
teardown, and the web household selector are implemented locally. The full SQL
sequence applies on a clean PostgreSQL 18 database; the Windows
Drizzle/integration runner cannot currently reach that WSL-only PostgreSQL port.
The local authenticated API now implements invitation acceptance,
member/invitation inventory, per-camera grant replacement, and revocation with
audit and immediate socket teardown. Its 16-case PostgreSQL integration suite
passes through a temporary local bridge (stopped after testing). The web settings
UI implements manual-code invitation creation/acceptance, member and pending-
invitation revocation, and independent View/Listen/Talk grants. Transactional
invitation email is now deployed through Resend with manual-code fallback for local
development. Next: complete inbox/bounce evidence, physical multi-account
acceptance, and independent security review.

The web viewer now includes a manifest and service worker for installable,
background-capable notification behavior. Treat broader offline media caching as
separate scope; live camera viewing still requires the network and authenticated
backend services.
