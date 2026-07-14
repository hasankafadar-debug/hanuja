#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL zorunlu}"
: "${PRIVATE_DOCUMENT_ROOT:?PRIVATE_DOCUMENT_ROOT zorunlu}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY zorunlu (örn. rclone:gdrive:hanuja-production)}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE zorunlu}"

work_dir="${BACKUP_WORK_DIR:-/var/lib/hanuja/backup-work}"
mkdir -p "$work_dir"
dump_path="$work_dir/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
trap 'rm -f "$dump_path"' EXIT

pg_dump --format=custom --no-owner --no-acl --file="$dump_path" "$DATABASE_URL"
restic backup "$dump_path" "$PRIVATE_DOCUMENT_ROOT" --tag hanuja-production
restic forget --tag hanuja-production --keep-daily 7 --keep-weekly 8 --keep-monthly 12 --keep-yearly 10 --prune
restic check --read-data-subset=2%
