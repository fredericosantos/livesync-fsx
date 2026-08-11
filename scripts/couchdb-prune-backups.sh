#!/usr/bin/env bash
#
# Delete CouchDB backup databases older than a retention window.
#
# CouchDB has no expiry of its own — verified against 3.5.1: the "scheduler"
# feature it advertises schedules replications, and no ttl/expire/retention key
# exists anywhere in its configuration. Something outside the database has to
# do it, and that something should be the server, not a note-taking app. This
# script is meant for cron on the host that runs CouchDB.
#
# It is deliberately hard to misuse:
#
#   * It refuses to consider any name that is not exactly
#     `<something>_backup_YYYYMMDD`. A live database cannot match that unless
#     someone names one that way on purpose.
#   * Age comes from the date in the name, never from a timestamp the database
#     could change under it.
#   * It keeps the newest backups regardless of age, so a long gap between
#     runs cannot leave you with none.
#   * It prints what it would do and exits. Deleting requires --yes.
#
# Nothing here has been run against the live server.
#
# Usage:
#   couchdb-prune-backups.sh [--days 30] [--keep-latest 1] [--yes]
#
# Credentials are read from the environment, the same ones the compose file
# uses: COUCHDB_USER, COUCHDB_PASSWORD, COUCHDB_PORT.

set -euo pipefail

DAYS=30
KEEP_LATEST=1
CONFIRMED=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --days) DAYS="$2"; shift 2 ;;
        --keep-latest) KEEP_LATEST="$2"; shift 2 ;;
        --yes) CONFIRMED=1; shift ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

: "${COUCHDB_USER:?set COUCHDB_USER}"
: "${COUCHDB_PASSWORD:?set COUCHDB_PASSWORD}"
PORT="${COUCHDB_PORT:-5984}"
BASE="http://127.0.0.1:${PORT}"
AUTH=(-u "${COUCHDB_USER}:${COUCHDB_PASSWORD}")

# The only shape this script will ever touch.
PATTERN='^[a-z0-9_-]+_backup_[0-9]{8}$'

cutoff=$(date -u -d "${DAYS} days ago" +%Y%m%d 2>/dev/null || date -u -v-"${DAYS}"d +%Y%m%d)

mapfile -t backups < <(
    curl -sf "${AUTH[@]}" "${BASE}/_all_dbs" \
        | python3 -c 'import json,sys; [print(n) for n in json.load(sys.stdin)]' \
        | grep -E "${PATTERN}" \
        | sort
)

if [[ ${#backups[@]} -eq 0 ]]; then
    echo "No backup databases found. Nothing to do."
    exit 0
fi

echo "Retention: older than ${DAYS} days (before ${cutoff}), always keeping the newest ${KEEP_LATEST}."
echo

keep_from=$(( ${#backups[@]} - KEEP_LATEST ))
doomed=()
for index in "${!backups[@]}"; do
    name="${backups[$index]}"
    stamp="${name##*_backup_}"
    if [[ ${index} -ge ${keep_from} ]]; then
        echo "  keep    ${name}  (among the newest ${KEEP_LATEST})"
    elif [[ "${stamp}" < "${cutoff}" ]]; then
        doomed+=("${name}")
        echo "  DELETE  ${name}  (dated ${stamp})"
    else
        echo "  keep    ${name}  (dated ${stamp}, within ${DAYS} days)"
    fi
done

echo
if [[ ${#doomed[@]} -eq 0 ]]; then
    echo "Nothing is old enough to remove."
    exit 0
fi

if [[ ${CONFIRMED} -ne 1 ]]; then
    echo "Dry run. Re-run with --yes to delete the ${#doomed[@]} database(s) marked above."
    exit 0
fi

for name in "${doomed[@]}"; do
    # Belt and braces: the pattern is checked again immediately before the
    # request, so no later edit to the loop above can widen what gets deleted.
    if [[ ! "${name}" =~ ${PATTERN} ]]; then
        echo "Refusing to delete ${name}: it is not a backup database." >&2
        exit 1
    fi
    echo "Deleting ${name}..."
    curl -sf -X DELETE "${AUTH[@]}" "${BASE}/${name}" >/dev/null
done

echo "Done. ${#doomed[@]} database(s) removed."
