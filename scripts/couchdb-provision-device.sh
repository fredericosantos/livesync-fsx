#!/usr/bin/env bash
#
# Give one device its own CouchDB account.
#
# Today every device authenticates as the server administrator, so a lost phone
# cannot be revoked without changing the password everywhere at once. This
# creates a member-level account scoped to a single database, which can be
# deleted on its own.
#
#   ./couchdb-provision-device.sh <device-name> <database>
#
# Reads COUCHDB_URL, COUCHDB_ADMIN and COUCHDB_ADMIN_PASSWORD from the
# environment. Prints the generated password once, to standard output, and
# never writes it anywhere.
#
# To revoke later:
#   curl -X DELETE -u admin:… "$COUCHDB_URL/_users/org.couchdb.user:<device-name>?rev=<rev>"
#   ...then remove the name from the database's _security members list.

set -euo pipefail

DEVICE="${1:-}"
DATABASE="${2:-}"
COUCHDB_URL="${COUCHDB_URL:-http://localhost:5984}"
ADMIN="${COUCHDB_ADMIN:-}"
ADMIN_PASSWORD="${COUCHDB_ADMIN_PASSWORD:-}"

if [[ -z "$DEVICE" || -z "$DATABASE" ]]; then
    echo "usage: $0 <device-name> <database>" >&2
    exit 64
fi

if [[ -z "$ADMIN" || -z "$ADMIN_PASSWORD" ]]; then
    echo "Set COUCHDB_ADMIN and COUCHDB_ADMIN_PASSWORD first." >&2
    exit 64
fi

# CouchDB usernames become part of a document id, so keep them boring.
if [[ ! "$DEVICE" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "Device name must be lowercase letters, digits, hyphen or underscore." >&2
    exit 65
fi

AUTH=(-u "${ADMIN}:${ADMIN_PASSWORD}")
JSON=(-H "Content-Type: application/json")

# Generated here rather than chosen, because a password typed once into a phone
# and never again should not be one a human invented.
PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"

echo "Creating account '${DEVICE}'..." >&2
curl -fsS -X PUT "${AUTH[@]}" "${JSON[@]}" \
    "${COUCHDB_URL}/_users/org.couchdb.user:${DEVICE}" \
    -d "{\"name\":\"${DEVICE}\",\"password\":\"${PASSWORD}\",\"roles\":[],\"type\":\"user\"}" \
    >/dev/null

echo "Adding '${DEVICE}' to the members of '${DATABASE}'..." >&2
CURRENT="$(curl -fsS "${AUTH[@]}" "${COUCHDB_URL}/${DATABASE}/_security")"

# Merged rather than replaced: overwriting _security would silently revoke every
# device already listed there.
UPDATED="$(DEVICE="$DEVICE" python3 - "$CURRENT" <<'PY'
import json, os, sys

security = json.loads(sys.argv[1]) or {}
members = security.setdefault("members", {})
names = members.setdefault("names", [])
roles = members.setdefault("roles", [])
if "_admin" not in roles:
    roles.append("_admin")
device = os.environ["DEVICE"]
if device not in names:
    names.append(device)
security.setdefault("admins", {"roles": ["_admin"]})
print(json.dumps(security))
PY
)"

curl -fsS -X PUT "${AUTH[@]}" "${JSON[@]}" \
    "${COUCHDB_URL}/${DATABASE}/_security" -d "${UPDATED}" >/dev/null

cat >&2 <<EOF

Done. Enter these on the device, and nowhere else:

  Username  ${DEVICE}
EOF
echo "  Password  ${PASSWORD}"
cat >&2 <<EOF

This password is not stored by this script and is not recoverable. If it is
lost, run the script again to replace the account.

The account is a member, not an administrator: it can read and write the vault
but cannot delete the database, compact it, or read any other database. It also
cannot create the database, so '${DATABASE}' must already exist.
EOF
