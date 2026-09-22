# Beacon SecureView: Omarchy development handoff

Updated 22 September 2026. GitHub: <https://github.com/builtbysai/Beacon-SecureView>. Read `AGENTS.md`, `docs/product-build-brief.md`, `docs/roadmap.md`, this file, and `docs/OMARCHY-SECRETS-HANDOFF.md` before editing. GitHub is the normal transfer source; the verified offline bundle is an emergency fallback.

## State and branches

| Purpose                                          | Ref at audit                                 | Commit                                     |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------ |
| Frozen frontend visual source of truth           | `frontend-recovery-final-2026-09-17`         | `af28b03a20637290622a2518a43677faa85f2b09` |
| Migration documentation base                     | `antigravity/recovery-checkpoint`            | `abde4eceef51a15eafb160e366d86c8ffd7fb648` |
| Next integration branch, created without merging | `frontend-backend-integration`               | `af28b03a20637290622a2518a43677faa85f2b09` |
| Backend reference branch                         | `backend-integration` remote                 | `e42f1ce738bf9ee2552a0ef6429e45e8efb4bda8` |
| Default branch                                   | `main`                                       | `839f607961b09f2f9f355ded30b1fac9d70c2901` |
| Preserved unfinished second worktree             | `codex/windows-worktree-recovery-2026-09-22` | `dbab4dcc5bd3f6b4258ea810426a35348d2add8d` |
| Preserved September 10 stash                     | `codex/windows-stash-recovery-2026-09-22`    | `41a03bb7fd5ed604d36d3f043d52949c9189469c` |

The intended next task is integrating the approved newer frontend design with backend state and APIs. Treat the frozen frontend as the visual source of truth. Extend backend/database state, metadata, and behavior to support it; audit and selectively cherry-pick useful `backend-integration` commits rather than blindly merging that branch. Do not merge during migration. The recovery worktree branch contains unfinished recording, Drive, notification, and Android changes; audit it before reuse. Existing `main` contains recording capture work and documents a Drizzle migration bug in `docs/development-handoff.md`.

## First clone and tools

```sh
mkdir -p ~/Code
cd ~/Code
git clone git@github.com:builtbysai/Beacon-SecureView.git
cd Beacon-SecureView
git fetch --all --prune --tags
git switch frontend-backend-integration
```

Install Git, a Node 22 version manager/runtime, Docker Engine with the Compose plugin, JDK 17, Android SDK command-line tools/Platform 35/build tools, and optionally Python. On Omarchy/Arch use `pacman` for system packages, then install/activate pnpm **11.9.0** with Corepack or its supported installer. Confirm `node --version`, `pnpm --version`, `docker compose version`, and `java -version`. Enable/start Docker for the user before running Compose. The repo's Gradle wrapper downloads Gradle 8.9; no system Gradle is needed. Run `bash scripts/dev/verify-environment.sh` for read-only checks.

## Dependencies, environment, database

```sh
pnpm install --frozen-lockfile
cp apps/backend/.env.example apps/backend/.env
docker compose -f infrastructure/docker/compose.yaml up -d postgres coturn
pnpm --filter @beacon/backend db:check
pnpm --filter @beacon/backend db:migrate
```

The local example supplies required `DATABASE_URL` and `TURN_SHARED_SECRET` for loopback only. Review only **names** in `docs/OMARCHY-SECRETS-HANDOFF.md` for optional Google, Drive, Firebase, Web Push, Resend and production integrations. Never copy Windows `.env` into Git. For integration tests, create a distinct disposable database with a `_test` suffix and set `TEST_DATABASE_URL`; the guard in `apps/backend/test/test-database.ts` rejects production/default DB names. Example with the local Compose container:

```sh
docker exec beacon-secureview-local-postgres-1 psql -U beacon_local -d postgres -c 'CREATE DATABASE beacon_secureview_test OWNER beacon_local;'
export TEST_DATABASE_URL='postgresql://beacon_local:local-development-only@127.0.0.1:5432/beacon_secureview_test'
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @beacon/backend db:migrate
```

Create the test DB only once. The repository has migrations but no general seed command; register a disposable account through the app. Windows local data includes ten user rows, zero recordings, zero Drive connections and zero push subscriptions. It is not required to bootstrap Omarchy; do not move an opaque DB dump by default. If any records prove irreplaceable, make an encrypted `pg_dump` only after owner review and keep it out of Git and the ordinary ZIP.

## Run and validate

```sh
pnpm dev                         # backend http://127.0.0.1:3000; viewer http://127.0.0.1:5173
pnpm --filter @beacon/web-viewer typecheck
pnpm --filter @beacon/web-viewer test
pnpm --filter @beacon/web-viewer build
pnpm --filter @beacon/backend typecheck
pnpm --filter @beacon/backend test
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @beacon/backend test
pnpm format:check
pnpm lint
bash apps/android-camera/gradlew -p apps/android-camera --no-daemon testDebugUnitTest lintDebug assembleDebug assembleRelease
```

The first backend test run without `TEST_DATABASE_URL` runs unit tests and skips guarded PostgreSQL integration suites. Apply migrations to the test DB first, then run again with the test URL. Android: set `ANDROID_HOME`/`ANDROID_SDK_ROOT`, install Platform 35 and build tools, and recreate `apps/android-camera/local.properties` with the Linux `sdk.dir` if needed. The committed build has no release `signingConfigs`; `assembleRelease` is an unsigned compilation check. For physical Android LAN testing, rebuild the Windows PowerShell workflow as a separate approved task; the Linux loopback/emulator workflow above is the initial bootstrap.

Firebase Android client config may be re-downloaded to ignored `apps/android-camera/app/google-services.json`. Server FCM service-account JSON, Google OAuth, Drive token key, VAPID pair, Resend key and production env are separate private provisioning tasks described in the secrets handoff. No production credential is required for the default loopback startup.

## Migration cautions

The Windows `.ps1` scripts and historical `C:\Dev\...` documentation are Windows-specific. Use the commands here on Linux. `.gitattributes` enforces LF for text and the shell/Gradle entrypoints have executable modes. `main` and `backend-integration` have changed independently from the frontend branch; inspect actual refs and diffs before development. Do not treat a green source build as proof that physical capture, TURN, email, push, or production integration works.

## Validation observed on Windows at handoff

The frozen frontend currently builds and typechecks, but its tests have 3 failures among 168 cases (two stale UI expectations and a missing `matchMedia` mock). Repository-wide formatting reports 89 files and ESLint reports 40 errors. These predate the migration documents and are not an Omarchy setup failure. Backend typecheck and 117 unit tests pass. With a dedicated migrated PostgreSQL `_test` database, all 200 backend tests pass. Android unit test, lint and debug/release compilation results are recorded in the offline audit package. Repair validation failures as a separate approved development task; do not silently equate them with a passing release gate.
