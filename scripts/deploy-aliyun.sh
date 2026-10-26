#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run typecheck
npm test
release="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
archive=$(mktemp -t babynote-release.XXXXXX)
trap 'rm -f "$archive"' EXIT
tar -czf "$archive" -C dist .
ssh aliyun-baby "mkdir -p /opt/babynote/releases/$release"
scp "$archive" "aliyun-baby:/opt/babynote/releases/$release/release.tar.gz"
ssh aliyun-baby bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
cd "/opt/babynote/releases/$release"
tar -xzf release.tar.gz
rm release.tar.gz
if test -L /opt/babynote/current; then
    ln -sfn "$(readlink /opt/babynote/current)" /opt/babynote/previous
fi
ln -sfn "/opt/babynote/releases/$release" /opt/babynote/current
systemctl restart babynote
for attempt in 1 2 3 4 5; do
    if curl --fail --silent http://127.0.0.1:3000/healthz; then exit 0; fi
    sleep 1
done
if test -L /opt/babynote/previous; then
    ln -sfn "$(readlink /opt/babynote/previous)" /opt/babynote/current
    systemctl restart babynote
fi
exit 1
REMOTE
