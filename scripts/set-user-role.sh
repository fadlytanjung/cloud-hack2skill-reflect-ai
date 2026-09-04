#!/usr/bin/env bash
# ==============================================================================
# ReflectAI - Assign a predefined role to a user in Cloud Firestore
#
# Administrator status is data, not code: the document users/{uid} in the
# `reflect-ai-app` Firestore database carries `role: "admin"`. Everyone who signs
# in is a standard user until that document says otherwise.
#
# Firestore security rules deliberately forbid a client from writing the `role`
# field, so it can only be set with a service-account credential. This script
# uses the Firestore REST API with a gcloud access token, which bypasses rules
# the same way the Admin SDK does.
#
# Usage:
#   ./scripts/set-user-role.sh fadlysyah96@gmail.com admin
#   ./scripts/set-user-role.sh someone@example.com user
#   ./scripts/set-user-role.sh --uid AbCdEf123 admin
#   ./scripts/set-user-role.sh --list          # show every user and their role
# ==============================================================================

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "")}"
DATABASE_ID="${FIREBASE_DATABASE_ID:-reflect-ai-app}"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "Error: no Google Cloud project. Set GCP_PROJECT_ID or run 'gcloud config set project ...'." >&2
  exit 1
fi

TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "Error: could not get an access token. Run 'gcloud auth login' first." >&2
  exit 1
fi

FIRESTORE_BASE="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents"
IDENTITY_BASE="https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}"

# Local Application Default Credentials carry no quota project, and
# identitytoolkit.googleapis.com refuses the request without one. Sending it
# explicitly avoids requiring `gcloud auth application-default set-quota-project`.
AUTH_HEADERS=(-H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: ${PROJECT_ID}")

# ------------------------------------------------------------------------------
# --list: print every user document with its role
# ------------------------------------------------------------------------------
if [ "${1:-}" = "--list" ]; then
  echo "Users in ${PROJECT_ID} / ${DATABASE_ID}:"
  curl -sS "${AUTH_HEADERS[@]}" "${FIRESTORE_BASE}/users?pageSize=300" \
    | python3 -c '
import json, sys
data = json.load(sys.stdin)
if "error" in data:
    sys.exit("  error: " + data["error"].get("message", "unknown"))
docs = data.get("documents") or []
if not docs:
    print("  (no user documents yet)")
for doc in docs:
    fields = doc.get("fields", {})
    uid = doc["name"].rsplit("/", 1)[-1]
    role = fields.get("role", {}).get("stringValue", "user (default)")
    email = fields.get("email", {}).get("stringValue", "-")
    marker = " <-- ADMIN" if role == "admin" else ""
    print(f"  {role:<16} {email:<34} {uid}{marker}")
'
  exit 0
fi

# ------------------------------------------------------------------------------
# Resolve the target user
# ------------------------------------------------------------------------------
UID_ARG=""
EMAIL_ARG=""
if [ "${1:-}" = "--uid" ]; then
  UID_ARG="${2:-}"
  ROLE="${3:-admin}"
  [ -n "$UID_ARG" ] || { echo "Error: --uid requires a value." >&2; exit 1; }
else
  EMAIL_ARG="${1:-}"
  ROLE="${2:-admin}"
  if [ -z "$EMAIL_ARG" ]; then
    echo "Usage: $0 <email> [admin|user]" >&2
    echo "       $0 --uid <uid> [admin|user]" >&2
    echo "       $0 --list" >&2
    exit 1
  fi
fi

case "$ROLE" in
  admin|user) ;;
  *) echo "Error: role must be 'admin' or 'user' (got '$ROLE')." >&2; exit 1 ;;
esac

if [ -n "$EMAIL_ARG" ]; then
  echo "Looking up Firebase Auth account for ${EMAIL_ARG}..."
  LOOKUP=$(curl -sS -X POST "${IDENTITY_BASE}/accounts:lookup" \
    "${AUTH_HEADERS[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":[\"${EMAIL_ARG}\"]}")

  # Distinct exit codes so a real API failure is never reported as "no such
  # user" -- swallowing that difference is what hid a 403 during development.
  #   2 = the API returned an error   3 = the API succeeded but matched nobody
  set +e
  UID_ARG=$(printf '%s' "$LOOKUP" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except ValueError:
    print("lookup returned a non-JSON response", file=sys.stderr)
    sys.exit(2)
if "error" in data:
    print("lookup failed: " + data["error"].get("message", "unknown"), file=sys.stderr)
    sys.exit(2)
users = data.get("users") or []
if not users:
    sys.exit(3)
print(users[0].get("localId", ""))
')
  LOOKUP_STATUS=$?
  set -e

  case "$LOOKUP_STATUS" in
    0) ;;
    3)
      cat >&2 <<MSG

Error: no Firebase Auth user found for ${EMAIL_ARG}.

The account must sign in to the app at least once before a role can be
assigned -- the uid is created by Firebase Auth, not by this script.
Pass --uid <uid> if you already know it.
MSG
      exit 1
      ;;
    *)
      echo "" >&2
      echo "Error: could not look up ${EMAIL_ARG} (see the message above)." >&2
      exit 1
      ;;
  esac
  echo "  uid: ${UID_ARG}"
fi

# ------------------------------------------------------------------------------
# Write the role. A field-scoped updateMask leaves every other profile field
# (email, displayName, photoURL, lastLoginAt) exactly as the app wrote it.
# ------------------------------------------------------------------------------
echo "Setting users/${UID_ARG}.role = '${ROLE}' in ${PROJECT_ID}/${DATABASE_ID}..."
RESPONSE=$(curl -sS -X PATCH \
  "${FIRESTORE_BASE}/users/${UID_ARG}?updateMask.fieldPaths=role" \
  "${AUTH_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"fields\":{\"role\":{\"stringValue\":\"${ROLE}\"}}}")

printf '%s' "$RESPONSE" | python3 -c '
import json, sys
data = json.load(sys.stdin)
if "error" in data:
    sys.exit("  error: " + data["error"].get("message", "unknown"))
fields = data.get("fields", {})
print("  role       :", fields.get("role", {}).get("stringValue", "(unset)"))
print("  email      :", fields.get("email", {}).get("stringValue", "(not yet synced)"))
print("  updateTime :", data.get("updateTime", "-"))
'

cat <<MSG

Done. The change takes effect on the user's next request:

  - The server reads users/{uid}.role on every /api/admin/* call, so admin
    access is live immediately.
  - The browser reads it on the next sign-in or page load.

Verify:  $0 --list
MSG
