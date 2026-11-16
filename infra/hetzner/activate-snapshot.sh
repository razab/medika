#!/bin/bash
set -euo pipefail

# The caller has already verified the archive checksum over SSH.
incoming=${1:?Specify a private staging directory under /var/lib/medika}
case "$incoming" in /var/lib/medika/incoming.*) ;; *) exit 2 ;; esac
root=/var/lib/medika
node=/opt/medika/runtime/bin/node
release=/opt/medika/current
test -f "$incoming/medika.sqlite"
"$node" "$release/infra/hetzner/snapshot.mjs" "$incoming"
chown -R medika:medika "$incoming"
find "$incoming" -type d -exec chmod 0700 {} +
find "$incoming" -type f -exec chmod 0600 {} +
previous=$(mktemp -d "$root/rollback.XXXXXX")
systemctl stop medika.service
mv "$root/data" "$previous/data"
if mv "$incoming" "$root/data" && systemctl start medika.service; then
  for attempt in 1 2 3 4 5; do
    if curl --silent --fail -H 'Host: medika.ibhash.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:4382/api/health; then
      printf '\nPrevious data kept in %s\n' "$previous"
      exit 0
    fi
    sleep 1
  done
fi
systemctl stop medika.service
if [ -d "$root/data" ]; then mv "$root/data" "$previous/failed"; fi
mv "$previous/data" "$root/data"
systemctl start medika.service
exit 1
