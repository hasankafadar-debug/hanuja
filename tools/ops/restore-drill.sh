#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY zorunlu}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE zorunlu}"
: "${RESTORE_DRILL_DATABASE_URL:?Boş ve production dışı test DB URL'si zorunlu}"

target="${RESTORE_DRILL_ROOT:-/var/lib/hanuja/restore-drill}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$target"
restic restore latest --tag hanuja-production --target "$target"
dump="$(find "$target" -type f -name 'postgres-*.dump' -print -quit)"
document="$(find "$target" -type f -path '*private-documents*' -name '*.bin' -print -quit)"
test -n "$dump" && test -n "$document"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DRILL_DATABASE_URL" "$dump"
pg_restore --list "$dump" >/dev/null
echo "RESTORE_DRILL_OK target=$target dump=$dump document=$document"
