#!/usr/bin/env bash
# ==============================================================================
# ReflectAI - Google Cloud Run Deployment Script
# Purpose: Dynamic, project-agnostic deployment to Cloud Run with Secret Manager
# Challenge Label: dev-tutorial=cloud-run-ai-challenge
# ==============================================================================

set -e

# Dynamically resolve Google Cloud Project ID
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "")}"
fi
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-}"
fi
if [ -z "$PROJECT_ID" ] && [ -f ".env" ]; then
  PROJECT_ID=$(grep -E "^(GCP_PROJECT_ID|VITE_FIREBASE_PROJECT_ID)=" .env | head -n 1 | cut -d'=' -f2 | tr -d '"' || true)
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  read -p "Enter your Google Cloud Project ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "Error: Google Cloud Project ID is required."
  exit 1
fi

# Dynamically resolve Google Cloud Project Number
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null || echo "")}"

SERVICE_NAME="${CLOUD_RUN_SERVICE:-reflectai-journal-reflection-assistant}"
REGION="${CLOUD_RUN_REGION:-us-west1}"
SECRET_NAME="${SECRET_NAME:-reflect-ai-env}"
# The env secret is mounted as a file in its own directory. It must NOT be
# mounted inside /app: Cloud Run mounts the volume over the whole directory,
# which would hide dist/ and node_modules/ and leave nothing to run.
SECRET_MOUNT_DIR="${SECRET_MOUNT_DIR:-/secrets}"
PORT=3000

echo "=========================================================="
echo "ReflectAI: Cloud Run Production Deployment"
echo "Project          : $PROJECT_ID ${PROJECT_NUMBER:+($PROJECT_NUMBER)}"
echo "Service          : $SERVICE_NAME"
echo "Region           : $REGION"
echo "Secret Manager   : $SECRET_NAME"
echo "Secret mount     : ${SECRET_MOUNT_DIR}/.env"
echo "Port             : $PORT"
echo "=========================================================="

# 1. Verify the build before spending a Cloud Build minute on it.
# `git push` is gated by .githooks/pre-push, but this script bypasses git
# entirely, so the same guards run here. Skip deliberately with SKIP_TESTS=1.
echo ""
echo "[1/5] Verifying build (type check + security tests)..."
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  echo "⚠  Verification skipped via SKIP_TESTS=1"
elif ! command -v bun >/dev/null 2>&1; then
  echo "⚠  bun not found on PATH — skipping local verification."
  echo "   Install bun (https://bun.sh) to gate deploys on the test suite."
else
  if [ ! -d node_modules ]; then
    echo "Installing dependencies (bun install --frozen-lockfile)..."
    bun install --frozen-lockfile
  fi
  bun run lint
  bun run test:security
  echo "✓ Type check and security tests passed"
fi

# 2. Ensure gcloud is configured
echo ""
echo "[2/5] Verifying gcloud configuration..."
gcloud config set project "$PROJECT_ID"

# 3. Sync local .env secrets to Google Cloud Secret Manager (if .env exists)
echo ""
echo "[3/5] Checking Google Cloud Secret Manager ($SECRET_NAME)..."
if [ -f ".env" ]; then
  echo "Found local .env file. Ensuring secret '$SECRET_NAME' exists in project '$PROJECT_ID'..."
  gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" 2>/dev/null || \
    gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project="$PROJECT_ID"
  
  echo "Uploading latest .env version to Secret Manager ($SECRET_NAME)..."
  gcloud secrets versions add "$SECRET_NAME" --data-file=".env" --project="$PROJECT_ID"
else
  echo "ℹ No local .env file detected. Using existing secret versions in Secret Manager '$SECRET_NAME'."
fi

# Grant Cloud Run service account permission to read the secret
if [ -n "$PROJECT_NUMBER" ]; then
  RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  echo "Granting Secret Accessor permission to runtime service account: $RUNTIME_SA..."
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" 2>/dev/null || true
fi

# 4. Build the image, normalize any legacy service spec, then deploy
echo ""
echo "[4/5] Building and deploying application container to Cloud Run ($SERVICE_NAME)..."

IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"
echo "Building container image using Cloud Build (${IMAGE_TAG})..."
gcloud builds submit --tag "${IMAGE_TAG}" --project="$PROJECT_ID" .

# A service first created by Google AI Studio carries source-deploy metadata that
# an image-based deploy cannot reconcile, and gcloud has no flag to remove it:
#
#   spec.template.metadata.annotations[run.googleapis.com/sources]:
#   Source annotation has sources that are not referenced by a container.
#
# The same spec also pins an entrypoint that overrides the image CMD, keeps
# secrets as plaintext env values, and mounts the env secret at /app, which
# shadows the application directory. normalize-cloud-run-service.py strips all of
# that in one `services replace`. It is idempotent and exits 3 when there is
# nothing to change.
if gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Checking existing service spec for legacy source-deploy metadata..."
  TEMP_SVC_YAML=$(mktemp)
  TEMP_CLEAN_YAML=$(mktemp)
  trap 'rm -f "$TEMP_SVC_YAML" "$TEMP_CLEAN_YAML"' EXIT

  gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" --project="$PROJECT_ID" --format=export > "$TEMP_SVC_YAML"

  set +e
  python3 "$(dirname "$0")/normalize-cloud-run-service.py" \
    --image "${IMAGE_TAG}" \
    --secret-mount-dir "${SECRET_MOUNT_DIR}" \
    < "$TEMP_SVC_YAML" > "$TEMP_CLEAN_YAML"
  NORMALIZE_STATUS=$?
  set -e

  case "$NORMALIZE_STATUS" in
    0)
      echo "Applying normalized service spec..."
      gcloud run services replace "$TEMP_CLEAN_YAML" \
        --region="$REGION" --project="$PROJECT_ID" --quiet
      echo "✓ Legacy service metadata removed"
      ;;
    3)
      echo "✓ Service spec already clean"
      ;;
    *)
      echo "Error: could not normalize the existing service spec." >&2
      exit 1
      ;;
  esac
fi

echo "Deploying container image to Cloud Run ($SERVICE_NAME)..."
gcloud run deploy "$SERVICE_NAME" \
  --image "${IMAGE_TAG}" \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --clear-env-vars \
  --set-env-vars="NODE_ENV=production,ENV_FILE=${SECRET_MOUNT_DIR}/.env" \
  --clear-secrets \
  --set-secrets="${SECRET_MOUNT_DIR}/.env=${SECRET_NAME}:latest" \
  --port "$PORT" \
  --project "$PROJECT_ID"

# 5. Apply mandatory challenge verification label
echo ""
echo "[5/5] Applying mandatory campaign label (dev-tutorial=cloud-run-ai-challenge)..."
gcloud run services update "$SERVICE_NAME" \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region="$REGION" \
  --project="$PROJECT_ID"

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" --project="$PROJECT_ID" --format="value(status.url)" 2>/dev/null || echo "")

echo ""
echo "=========================================================="
echo "🎉 Cloud Run Deployment Complete!"
if [ -n "$SERVICE_URL" ]; then
  echo "Service URL: $SERVICE_URL"
fi
echo "=========================================================="
