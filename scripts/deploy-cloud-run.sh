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
PORT=3000

echo "=========================================================="
echo "ReflectAI: Cloud Run Production Deployment"
echo "Project          : $PROJECT_ID ${PROJECT_NUMBER:+($PROJECT_NUMBER)}"
echo "Service          : $SERVICE_NAME"
echo "Region           : $REGION"
echo "Secret Manager   : $SECRET_NAME"
echo "Port             : $PORT"
echo "=========================================================="

# 1. Ensure gcloud is configured
echo ""
echo "[1/4] Verifying gcloud configuration..."
gcloud config set project "$PROJECT_ID"

# 2. Sync local .env secrets to Google Cloud Secret Manager (if .env exists)
echo ""
echo "[2/4] Checking Google Cloud Secret Manager ($SECRET_NAME)..."
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

# 3. Deploy to Google Cloud Run
echo ""
echo "[3/4] Deploying application container to Cloud Run ($SERVICE_NAME)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --platform managed \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-secrets=/app/.env="${SECRET_NAME}:latest" \
  --port "$PORT" \
  --project "$PROJECT_ID"

# 4. Apply mandatory challenge verification label
echo ""
echo "[4/4] Applying mandatory campaign label (dev-tutorial=cloud-run-ai-challenge)..."
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
