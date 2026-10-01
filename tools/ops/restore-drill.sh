#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly CONFIG="${HANUJA_BACKUP_CONFIG:-/etc/hanuja-backup/backup.env}"
readonly RESTIC_RCLONE_ARGS='serve restic --stdio --b2-hard-delete --tpslimit 2 --tpslimit-burst 1 --drive-pacer-min-sleep 500ms'

[[ -r "$CONFIG" ]] || { echo "Missing $CONFIG" >&2; exit 2; }
# shellcheck source=/dev/null
source "$CONFIG"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RCLONE_CONFIG RESTIC_CACHE_DIR

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY zorunlu}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE zorunlu}"
: "${RESTORE_DRILL_DATABASE_URL:?RESTORE_DRILL_DATABASE_URL zorunlu}"

# A typo in the URL must never turn a drill into a destructive production restore.
# Require a dedicated database name and no existing user relations before even
# downloading the backup. Do not print the connection string or database contents.
guard="$(psql --no-psqlrc --dbname="$RESTORE_DRILL_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --tuples-only --no-align --command="SELECT CASE WHEN current_database() ~ '^hanuja_restore_drill(_[a-zA-Z0-9]+)?$' AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema') THEN 'SAFE_EMPTY_DRILL_DATABASE' ELSE 'UNSAFE_DATABASE' END")"
[[ "$guard" == 'SAFE_EMPTY_DRILL_DATABASE' ]] || {
  echo 'Restore drill requires an empty hanuja_restore_drill[_suffix] database.' >&2
  exit 2
}

target="${RESTORE_DRILL_ROOT:-/var/lib/hanuja/restore-drill}/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$target"
restic -o "rclone.args=$RESTIC_RCLONE_ARGS" restore latest --tag full-6h --target "$target"
dump="$(find "$target" -type f -path '*/db/hanuja-postgres16/database.dump' -print -quit)"
document_archive="$(find "$target" -type f -path '*/private/private-documents.tar' -print -quit)"
test -n "$dump" && test -n "$document_archive"
tar -tf "$document_archive" | grep -Eq '^private-documents/[0-9a-f]{2}/[0-9a-f-]{36}\.bin$'
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DRILL_DATABASE_URL" "$dump"
pg_restore --list "$dump" >/dev/null
echo "RESTORE_DRILL_OK target=$target dump=$dump private_archive=$document_archive"
