#!/usr/bin/env bash
set -euo pipefail

# The relay entrypoint must pass the container's own address as the relay address and as the one allowed
# private peer, and must refuse to start on anything that is not a single concrete IPv4 address.
script="$(cd "$(dirname "$0")" && pwd)/turn-relay-entrypoint.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"

cat >"$work/bin/hostname" <<'MOCK'
#!/bin/sh
printf '%s\n' "$MOCK_HOST_IP"
MOCK
cat >"$work/bin/turnserver" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*"
MOCK
chmod +x "$work/bin/hostname" "$work/bin/turnserver"

run() { PATH="$work/bin:$PATH" MOCK_HOST_IP="$1" sh "$script" -c /etc/coturn/turnserver.conf; }

output=$(run 172.20.0.2)
test "$output" = '-c /etc/coturn/turnserver.conf --relay-ip=172.20.0.2 --allowed-peer-ip=172.20.0.2'

for bad in '' '0.0.0.0' '127.0.0.1' '::1' 'fe80::1' '10.0.0.1 10.0.0.2'; do
  if run "$bad" >/dev/null 2>&1; then
    echo "Expected the entrypoint to refuse '$bad'." >&2
    exit 1
  fi
done

echo 'Beacon TURN relay entrypoint checks passed.'
