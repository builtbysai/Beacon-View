#!/bin/sh
set -eu

# Two relayed sessions on this one server (a camera and a viewer that both need the relay) reach each other
# through the server's own address, which coturn maps back to this container's address. That address sits
# inside a private range, and the private ranges must stay denied so the relay cannot be used to reach the
# backend, PostgreSQL or anything else on the same network.
#
# So the three private ranges that can contain a container address are denied here, with a one-address hole
# for this container; everything else is denied in turnserver.conf. (coturn's allowed-peer-ip was tried for
# the hole and made every private address reachable, so it is not used.)
relay_ip=$(hostname -i)
case "$relay_ip" in
  ""|0.*|127.*|*:*|*[!0-9.]*)
    echo 'TURN startup requires one concrete container IPv4 address' >&2
    exit 1
    ;;
esac

to_int() {
  oldIFS=$IFS
  IFS=.
  # shellcheck disable=SC2086
  set -- $1
  IFS=$oldIFS
  echo $((($1 << 24) + ($2 << 16) + ($3 << 8) + $4))
}

to_ip() {
  echo "$(($1 >> 24 & 255)).$(($1 >> 16 & 255)).$(($1 >> 8 & 255)).$(($1 & 255))"
}

ip=$(to_int "$relay_ip")
denied=""
for range in 10.0.0.0-10.255.255.255 172.16.0.0-172.31.255.255 192.168.0.0-192.168.255.255; do
  lo=$(to_int "${range%-*}")
  hi=$(to_int "${range#*-}")
  if [ "$ip" -ge "$lo" ] && [ "$ip" -le "$hi" ]; then
    [ "$ip" -gt "$lo" ] && denied="$denied --denied-peer-ip=$(to_ip "$lo")-$(to_ip $((ip - 1)))"
    [ "$ip" -lt "$hi" ] && denied="$denied --denied-peer-ip=$(to_ip $((ip + 1)))-$(to_ip "$hi")"
  else
    denied="$denied --denied-peer-ip=$range"
  fi
done

# shellcheck disable=SC2086
exec turnserver "$@" "--relay-ip=$relay_ip" $denied
