# Omarchy development environment

## Source versions and Windows observation (22 September 2026)

| Tool                  | Repository requirement                                                     | Windows observation                                                       |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Git                   | current supported version                                                  | 2.55.0.windows.3                                                          |
| Node.js               | `>=22.13.0 <23` (`package.json`); CI 22.14.0                               | 22.22.0                                                                   |
| pnpm                  | **11.9.0** (`packageManager` and CI)                                       | 11.9.0                                                                    |
| npm / Corepack        | Corepack may activate pnpm; npm is not the package manager                 | npm 10.9.4 / Corepack 0.35.0                                              |
| Docker / Compose      | Compose plugin; local PostgreSQL `postgres:17.6-alpine`, Coturn `4.6.3-r3` | Docker 29.8.0 / Compose 5.5.1                                             |
| PostgreSQL client     | optional; Compose container supplies `psql`                                | no host `psql` in PATH                                                    |
| Java                  | JDK 17 (CI Temurin 17)                                                     | no `java` in Windows PATH; Android Studio JBR may be present              |
| Gradle                | repository wrapper **8.9**                                                 | wrapper committed                                                         |
| Android Gradle Plugin | **8.7.3**                                                                  | build script                                                              |
| Kotlin                | **2.1.0**                                                                  | build script                                                              |
| Android SDK           | compile/target 35, min 26; Platform 35                                     | ignored `local.properties` exists; SDK version not independently verified |
| Python                | not needed for normal application build                                    | 3.14.7                                                                    |
| Git LFS               | repository has no LFS pointers                                             | git-lfs 3.7.1 installed                                                   |

Use pnpm with the committed lockfile: `pnpm install --frozen-lockfile`. The standard Linux workflow uses `docker compose -f infrastructure/docker/compose.yaml`, `pnpm dev`, and `bash apps/android-camera/gradlew -p apps/android-camera`. Windows `.ps1` launchers are conveniences, not Linux entrypoints. The Gradle wrapper and committed cloud shell scripts gained executable modes in migration commit `73191da`.
