#!/usr/bin/env bash
# ==============================================================================
# ReflectAI - Firebase Hosting & Firestore Rules Deployment Script
# Purpose: Dynamic, project-agnostic deployment for Firebase Hosting and rules
# ==============================================================================

set -e

# Dynamically resolve Google Cloud / Firebase Project ID
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
  read -p "Enter your Google Cloud / Firebase Project ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "Error: Project ID is required for deployment."
  exit 1
fi

SITE_NAME="${FIREBASE_HOSTING_SITE:-${PROJECT_ID}-reflect-ai}"
FALLBACK_SITE="${PROJECT_ID}"
DATABASE_ID="${FIREBASE_DATABASE_ID:-reflect-ai-app}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE:-reflectai-journal-reflection-assistant}"
CLOUD_RUN_REGION="${CLOUD_RUN_REGION:-us-west1}"
SECRET_NAME="${SECRET_NAME:-reflect-ai-env}"

echo "=========================================================="
echo "ReflectAI: Firebase Hosting & Security Rules Deployment"
echo "Target Project    : $PROJECT_ID"
echo "Firestore DB      : $DATABASE_ID"
echo "Secret Manager    : $SECRET_NAME"
echo "Hosting Domain    : https://${SITE_NAME}.web.app"
echo "Cloud Run Service : $CLOUD_RUN_SERVICE ($CLOUD_RUN_REGION)"
echo "=========================================================="

# Step 1: Ensure user is logged in
echo ""
echo "[1/5] Checking Firebase CLI authentication..."
firebase login:list || {
  echo "Please authenticate with Firebase CLI: firebase login"
  exit 1
}

# Step 2: Verify/create dedicated hosting site
echo ""
echo "[2/5] Verifying/creating Firebase Hosting site '${SITE_NAME}'..."
if firebase hosting:sites:create "$SITE_NAME" --project "$PROJECT_ID" 2>/dev/null; then
  echo "✓ Successfully verified/created Firebase Hosting site: ${SITE_NAME}"
else
  echo "ℹ Site '${SITE_NAME}' already registered or using default site in project '${PROJECT_ID}'."
fi

# Step 3: Deploy Firestore Security Rules to reflect-ai-app and (default)
echo ""
echo "[3/5] Deploying Firestore Security Rules to database '${DATABASE_ID}'..."
firebase deploy --only firestore:rules --project "$PROJECT_ID"

# Step 4: Build production assets
echo ""
echo "[4/5] Building production web bundle..."
npm run build

# Step 5: Deploy Firebase Hosting
echo ""
echo "[5/5] Deploying assets to Firebase Hosting with Cloud Run rewrites..."
if firebase deploy --only hosting --project "$PROJECT_ID"; then
  echo ""
  echo "=========================================================="
  echo "🎉 Deployment Successful!"
  echo "Your application is now live at clean URLs:"
  echo "  • https://${SITE_NAME}.web.app"
  echo "  • https://${SITE_NAME}.firebaseapp.com"
  echo "=========================================================="
else
  echo ""
  echo "ℹ If '${SITE_NAME}' is not the primary site name, you can deploy to your default domain:"
  echo "  Domain: https://${FALLBACK_SITE}.web.app"
  echo "To do this, update 'site': '${FALLBACK_SITE}' in firebase.json or specify FIREBASE_HOSTING_SITE."
fi
