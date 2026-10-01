#!/usr/bin/env bash
# Execute the real drill with fake psql/restic/tar/pg_restore commands only.
set -Eeuo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo="$(cd -- "$here/../../.." && pwd -P)"
temp_root="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"
scratch="$(mktemp -d "$temp_root/hanuja-restore-test.XXXXXX")"
scratch="$(cd -- "$scratch" && pwd -P)"
cleanup() {
  case "$scratch" in
    "$temp_root"/hanuja-restore-test.*) rm -rf -- "$scratch" ;;
    *) echo 'Refusing unexpected temporary path' >&2; return 1 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$scratch/bin"
export STUB_LOG="$scratch/calls" HANUJA_BACKUP_CONFIG="$scratch/config"
cat >"$scratch/config" <<EOF
RESTIC_REPOSITORY=offline-stub
RESTIC_PASSWORD_FILE=$scratch/password
RCLONE_CONFIG=$scratch/rclone
RESTIC_CACHE_DIR=$scratch/cache
RESTORE_DRILL_DATABASE_URL=offline-stub
RESTORE_DRILL_ROOT=$scratch/restored
EOF
cat >"$scratch/bin/psql" <<'EOF'
#!/usr/bin/env bash
echo psql >>"$STUB_LOG"
case "$FAKE_CASE" in
  nonempty|wrong-name) echo UNSAFE_DATABASE ;;
  connection-failed) exit 1 ;;
  valid) echo SAFE_EMPTY_DRILL_DATABASE ;;
  *) exit 99 ;;
esac
EOF
cat >"$scratch/bin/restic" <<'EOF'
#!/usr/bin/env bash
set -e
echo restic >>"$STUB_LOG"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --target ]]; then target="$2"; break; fi
  shift
done
mkdir -p "$target/snapshot/db/hanuja-postgres16" "$target/snapshot/private"
: >"$target/snapshot/db/hanuja-postgres16/database.dump"
: >"$target/snapshot/private/private-documents.tar"
EOF
cat >"$scratch/bin/tar" <<'EOF'
#!/usr/bin/env bash
echo private-documents/ab/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.bin
EOF
cat >"$scratch/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
echo pg_restore >>"$STUB_LOG"
for arg in "$@"; do [[ "$arg" != --clean && "$arg" != --if-exists ]] || exit 99; done
EOF
chmod +x "$scratch/bin/"*
export PATH="$scratch/bin:$PATH"
for FAKE_CASE in nonempty wrong-name connection-failed; do
  export FAKE_CASE
  : >"$STUB_LOG"
  if bash "$repo/tools/ops/restore-drill.sh" >"$scratch/output" 2>&1; then
    echo "Unsafe case accepted: $FAKE_CASE" >&2; exit 1
  fi
  [[ "$(cat "$STUB_LOG")" == psql ]] || { echo 'Backup or restore ran after failed guard' >&2; exit 1; }
done
export FAKE_CASE=valid
: >"$STUB_LOG"
bash "$repo/tools/ops/restore-drill.sh" >"$scratch/output" 2>&1
[[ "$(grep -c '^restic$' "$STUB_LOG")" == 1 ]]
[[ "$(grep -c '^pg_restore$' "$STUB_LOG")" == 2 ]]
grep -q RESTORE_DRILL_OK "$scratch/output"
echo '4 restore guard scenarios passed with local command stubs; no database or backup repository contacted'
