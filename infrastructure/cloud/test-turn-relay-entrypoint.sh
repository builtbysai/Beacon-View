#!/usr/bin/env bash
set -euo pipefail

# The relay entrypoint must pass the container's own address as the relay address, deny the private ranges
# except that one address, and must refuse to start on anything that is not a single concrete IPv4 address.
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

expect() {
  actual=$(run "$1")
  if [ "$actual" != "$2" ]; then
    printf 'For %s expected:
  %s
got:
  %s
' "$1" "$2" "$actual" >&2
    exit 1
  fi
}

# A container address inside 172.16.0.0/12 is the one address left open; the rest of the range stays denied.
expect 172.20.0.2 '-c /etc/coturn/turnserver.conf --relay-ip=172.20.0.2 --denied-peer-ip=10.0.0.0-10.255.255.255 --denied-peer-ip=172.16.0.0-172.20.0.1 --denied-peer-ip=172.20.0.3-172.31.255.255 --denied-peer-ip=192.168.0.0-192.168.255.255'
# At the edge of a range only one side is needed.
expect 10.0.0.0 '-c /etc/coturn/turnserver.conf --relay-ip=10.0.0.0 --denied-peer-ip=10.0.0.1-10.255.255.255 --denied-peer-ip=172.16.0.0-172.31.255.255 --denied-peer-ip=192.168.0.0-192.168.255.255'
# A public address has no hole at all.
expect 203.0.113.9 '-c /etc/coturn/turnserver.conf --relay-ip=203.0.113.9 --denied-peer-ip=10.0.0.0-10.255.255.255 --denied-peer-ip=172.16.0.0-172.31.255.255 --denied-peer-ip=192.168.0.0-192.168.255.255'

for bad in '' '0.0.0.0' '127.0.0.1' '::1' 'fe80::1' '10.0.0.1 10.0.0.2'; do
  if run "$bad" >/dev/null 2>&1; then
    echo "Expected the entrypoint to refuse '$bad'." >&2
    exit 1
  fi
done

echo 'Beacon TURN relay entrypoint checks passed.'
