#!/bin/sh
set -eu

# Coturn maps the server's own public address back to its relay address, so two
# relayed sessions on this one server (a camera and a viewer that both need the
# relay) show up as a peer inside the container's private range. The denied
# private ranges in turnserver.conf would then refuse the very pair the relay
# exists for. Resolve the container address on every start and allow exactly
# that one address; every other private, loopback and link-local range stays denied.
relay_ip=$(hostname -i)
case "$relay_ip" in
  ""|0.*|127.*|*:*|*[!0-9.]*)
    echo 'TURN startup requires one concrete container IPv4 address' >&2
    exit 1
    ;;
esac

exec turnserver "$@" "--relay-ip=$relay_ip" "--allowed-peer-ip=$relay_ip"
