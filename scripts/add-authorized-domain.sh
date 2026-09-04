#!/usr/bin/env bash
# ==============================================================================
# ReflectAI - Add an Authorized Domain to Firebase Authentication / Identity Platform
#
# When previewing in AI Studio (or deploying to custom Cloud Run URLs), the
# domain must be listed in Firebase Auth's Authorized Domains.
#
# Usage:
#   ./scripts/add-authorized-domain.sh <domain-to-add>
#   ./scripts/add-authorized-domain.sh --list
# ==============================================================================

set -euo pipefail

# Fallback to firebase-applet-config.json if GCP_PROJECT_ID is unset
CONFIG_FILE="$(dirname "$0")/../firebase-applet-config.json"
APPLET_PROJECT_ID=""
if [ -f "$CONFIG_FILE" ]; then
  APPLET_PROJECT_ID="$(grep -o '"projectId"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" | head -n1 | cut -d'"' -f4 || true)"
fi

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "$APPLET_PROJECT_ID")}"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "Error: no Google Cloud project. Set GCP_PROJECT_ID or run 'gcloud config set project <PROJECT_ID>'." >&2
  exit 1
fi

TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "Error: could not get an access token. Run 'gcloud auth login' first." >&2
  echo "" >&2
  echo "Alternatively, add the domain directly in the Firebase Console:" >&2
  echo "https://console.firebase.google.com/project/${PROJECT_ID}/authentication/settings" >&2
  exit 1
fi

AUTH_HEADERS=(-H "Authorization: Bearer ${TOKEN}" -H "x-goog-user-project: ${PROJECT_ID}")
CONFIG_URL="https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config"

TARGET_DOMAIN="${1:-}"

# Fetch current config
CONFIG_JSON=$(curl -sS "${AUTH_HEADERS[@]}" "$CONFIG_URL")

if echo "$CONFIG_JSON" | grep -q '"error"'; then
  echo "Error fetching Identity Toolkit configuration:" >&2
  echo "$CONFIG_JSON" >&2
  echo "" >&2
  echo "You can manage authorized domains in the Firebase Console:" >&2
  echo "https://console.firebase.google.com/project/${PROJECT_ID}/authentication/settings" >&2
  exit 1
fi

if [ "$TARGET_DOMAIN" = "--list" ]; then
  echo "Authorized domains for project ${PROJECT_ID}:"
  python3 -c '
import json, sys
data = json.load(sys.stdin)
domains = data.get("authorizedDomains", [])
for d in domains:
    print(f"  - {d}")
' <<< "$CONFIG_JSON"
  exit 0
fi

if [ -z "$TARGET_DOMAIN" ]; then
  echo "Usage: ./scripts/add-authorized-domain.sh <domain>"
  echo ""
  echo "Current authorized domains:"
  python3 -c '
import json, sys
data = json.load(sys.stdin)
domains = data.get("authorizedDomains", [])
for d in domains:
    print(f"  - {d}")
' <<< "$CONFIG_JSON"
  exit 0
fi

# Clean protocol/slashes if user passed full URL
CLEAN_DOMAIN=$(echo "$TARGET_DOMAIN" | sed -e 's|^https://||' -e 's|^http://||' -e 's|/.*$||' | tr -d ' ')

# Check if domain is already present
IS_PRESENT=$(python3 -c '
import json, sys
data = json.load(sys.stdin)
domains = data.get("authorizedDomains", [])
target = sys.argv[1]
print("yes" if target in domains else "no")
' "$CLEAN_DOMAIN" <<< "$CONFIG_JSON")

if [ "$IS_PRESENT" = "yes" ]; then
  echo "✓ Domain '${CLEAN_DOMAIN}' is already an authorized domain for ${PROJECT_ID}."
  exit 0
fi

echo "Adding '${CLEAN_DOMAIN}' to authorized domains for project ${PROJECT_ID}..."

PATCH_PAYLOAD=$(python3 -c '
import json, sys
data = json.load(sys.stdin)
domains = data.get("authorizedDomains", [])
target = sys.argv[1]
if target not in domains:
    domains.append(target)
print(json.dumps({"authorizedDomains": domains}))
' "$CLEAN_DOMAIN" <<< "$CONFIG_JSON")

RESPONSE=$(curl -sS -X PATCH \
  "${AUTH_HEADERS[@]}" \
  -H "Content-Type: application/json" \
  "${CONFIG_URL}?updateMask=authorizedDomains" \
  -d "$PATCH_PAYLOAD")

if echo "$RESPONSE" | grep -q '"error"'; then
  echo "Error updating authorized domains:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "✓ Successfully added '${CLEAN_DOMAIN}' to Firebase Authorized Domains!"
