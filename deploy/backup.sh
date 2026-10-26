#!/bin/sh
set -eu
umask 077
backup_dir=/var/backups/babynote
mkdir -p "$backup_dir"
file="$backup_dir/babynote-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
sqlite3 /var/lib/babynote/babynote.sqlite ".backup '$file'"
test "$(sqlite3 "$file" 'PRAGMA integrity_check;')" = ok
find "$backup_dir" -name 'babynote-*.sqlite' -type f -mtime +14 -delete
