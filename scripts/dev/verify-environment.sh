#!/usr/bin/env bash
set -u

cd "$(dirname "$0")/../.." || exit 1
fail=0
check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    printf 'OK   %-16s %s\n' "$1" "$(command -v "$1")"
  else
    printf 'MISS %-16s\n' "$1"
    fail=1
  fi
}

for tool in git node pnpm docker java; do check_command "$tool"; done
if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then echo 'OK   docker compose'; else echo 'MISS docker compose'; fail=1; fi
  if docker info >/dev/null 2>&1; then echo 'OK   docker daemon'; else echo 'MISS docker daemon access'; fail=1; fi
fi
if [ -f apps/backend/.env ]; then echo 'OK   apps/backend/.env'; else echo 'MISS apps/backend/.env (copy the example)'; fail=1; fi
if [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then echo 'OK   Android SDK path set'; else echo 'INFO Android SDK path not set'; fi
if [ -f apps/android-camera/app/google-services.json ]; then echo 'INFO optional Firebase Android client config present'; else echo 'INFO optional Firebase Android client config absent'; fi
if [ -x apps/android-camera/gradlew ]; then echo 'OK   Gradle wrapper executable'; else echo 'MISS Gradle wrapper executable'; fail=1; fi
if [ "$fail" -eq 0 ]; then echo 'Environment prerequisites present (versions/configuration still require review).'; else echo 'Environment prerequisites incomplete.'; fi
exit "$fail"
