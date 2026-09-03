# ReflectAI - Production Deployment & Architecture Guide

A secure, user-authenticated journaling and multi-turn reflection application powered by **Gemini 3.6 Flash**, **Cloud Firestore**, and **Firebase Authentication**, running on Google Cloud Run.

---

## 1. Architecture & Security Overview

- **Frontend**: React 19 + Tailwind CSS + Lucide Icons + Motion Layout.
- **Backend API**: Node.js Express full-stack proxy routing Gemini API requests with a resilient model fallback ladder (`gemini-3.6-flash` &rarr; `gemini-3.1-flash-lite` &rarr; `gemini-flash-latest` &rarr; `gemini-3.7-flash`).
- **Authentication**: Firebase Authentication with Google Sign-In (federated passwordless identity) and Role-Based Access Control (RBAC).
- **Database**: Google Cloud Firestore with owner-isolated security rules restricting all reads and writes strictly to `/users/{userId}/interactions/{interactionId}` where `request.auth.uid == userId` and `/admin/{document=**}` for administrative roles.
- **Outbound Webhook Engine**: Server-side HTTPS webhook dispatcher with strict private-network and SSRF validation.
- **Secret Management**: Google Cloud Secret Manager for `GEMINI_API_KEY`, `WEBHOOK_URL`, and `MAPS_API_KEY`.

---

## 2. Prerequisites & Cloud Setup

Ensure you have the Google Cloud CLI (`gcloud`) installed, authenticated, and targeting your Google Cloud project:

```bash
gcloud auth login
gcloud config set project <YOUR_GCP_PROJECT_ID>
```

Enable the necessary Google Cloud APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com
```

---

## 3. Secret Management via Secret Manager (`reflect-ai-env`)

ReflectAI manages its operational configuration securely using a single Google Cloud Secret Manager secret named **`reflect-ai-env`**, mounting all environment variables directly into the Cloud Run container.

### Named Credential Mappings (Explicit, Unambiguous Identifiers)
- **Firebase Web API Key**: Explicitly named **`reflect-ai-app`** in Google Cloud Console &rarr; APIs & Services &rarr; Credentials (eliminating vague auto-generated names like `Browser key (auto created by Firebase)`).
- **OAuth 2.0 Client ID**: Named **`reflect-ai-app`** with authorized redirect domain `https://<YOUR_GCP_PROJECT_ID>.firebaseapp.com`.
- **Firebase Hosting Site**: Defaults to your project domain or dedicated multisite.
- **External Notifications**: **`DISCORD_WEBHOOK_URL`** (Discord webhook URL for synthesized takeaways).

### Provisioning `reflect-ai-env` in Secret Manager:

```bash
# 1. Prepare your local .env file using .env.example as the template
# (Ensure GEMINI_API_KEY, MAPS_API_KEY, DISCORD_WEBHOOK_URL, VITE_FIREBASE_API_KEY are populated)

# Set your project ID
export GCP_PROJECT_ID="<YOUR_GCP_PROJECT_ID>"

# 2. Push the complete environment payload to Secret Manager
gcloud secrets create reflect-ai-env --replication-policy="automatic" --project="${GCP_PROJECT_ID}" || true
gcloud secrets versions add reflect-ai-env --data-file=.env --project="${GCP_PROJECT_ID}"

# 3. Grant the Cloud Run default service account permission to read the secret
PROJECT_NUMBER=$(gcloud projects describe "${GCP_PROJECT_ID}" --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding reflect-ai-env \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${GCP_PROJECT_ID}"
```

---

## 4. Database Security Configuration (Cloud Firestore)

Deploy the following security rules to enforce owner isolation and RBAC:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // User-owned entries and reflections
    match /users/{userId}/interactions/{interactionId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Role-Based Access Control (Admin Dashboard)
    function isAdmin() {
      return request.auth != null && 
             (request.auth.token.admin == true || 
              get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }

    match /admin/{document=**} {
      allow read, write: if isAdmin();
    }
  }
}
```

To deploy rules to both `(default)` and `reflect-ai-app` databases via Firebase CLI:

```bash
firebase deploy --only firestore:rules --project <YOUR_GCP_PROJECT_ID>
```

---

## 5. Cloud Run Deployment

Deploy the container to Google Cloud Run with automated Secret Manager binding:

### Using the Automated Deployment Script:
```bash
npm run deploy:cloud-run
# or: bash scripts/deploy-cloud-run.sh
```

### Or Manually via gcloud:
```bash
# Build and deploy with Secret Manager environment injection
gcloud run deploy reflectai-journal-reflection-assistant \
  --source . \
  --platform managed \
  --region us-west1 \
  --allow-unauthenticated \
  --set-secrets=/app/.env=reflect-ai-env:latest \
  --port 3000 \
  --project <YOUR_GCP_PROJECT_ID>
```

---

## 6. Firebase Hosting & Clean Custom Domain Setup

Rather than accessing the application via the generated Cloud Run URL, Firebase Hosting provides a clean, brandable domain with global CDN edge caching, automatic free SSL, and zero random numerical hashes.

### How It Works (Cloud Run Rewrites in `firebase.json`)
The `firebase.json` file is configured with direct Cloud Run rewrites:
```json
{
  "hosting": {
    "public": "dist",
    "cleanUrls": true,
    "rewrites": [
      {
        "source": "**",
        "run": {
          "serviceId": "reflectai-journal-reflection-assistant",
          "region": "us-west1"
        }
      }
    ]
  }
}
```
All static bundles are served from the high-speed edge CDN, while all dynamic interactions and `/api/*` endpoints (like SSE streaming reflections) are seamlessly routed to your Cloud Run service.

### Quick Deploy (2 Simple Steps)

1. **Build and Deploy to Firebase Hosting**:
   ```bash
   npm run build
   firebase deploy --only hosting --project <YOUR_GCP_PROJECT_ID>
   ```
   *(Or use the automated script: `npm run deploy:hosting`)*

2. **Dedicated Multisite (Optional)**:
   If you wish to create a dedicated multisite like `<YOUR_PROJECT_ID>-reflect-ai`:
   ```bash
   firebase hosting:sites:create <YOUR_PROJECT_ID>-reflect-ai --project <YOUR_GCP_PROJECT_ID>
   firebase deploy --only hosting --project <YOUR_GCP_PROJECT_ID>
   ```

### Firebase Auth Authorized Domains
Ensure your hosting domain is authorized in Firebase Authentication:
1. Go to [Firebase Console](https://console.firebase.google.com/) &rarr; **Authentication** &rarr; **Settings** &rarr; **Authorized domains**.
2. Verify that `<YOUR_GCP_PROJECT_ID>.firebaseapp.com` and `<YOUR_GCP_PROJECT_ID>.web.app` are listed.

---

## 7. Required Campaign Labeling

Apply the mandatory resource label to register your Cloud Run service for automated challenge verification:

```bash
gcloud run services update reflectai-journal-reflection-assistant \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=us-west1 \
  --project=<YOUR_GCP_PROJECT_ID>
```

---

## 8. Local Development

To run the full-stack dev server locally:

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to interact with the application.

---

## 9. GitHub Security: Purging Leaked Keys & History Remediation

If credentials or local config files (`firebase-applet-config.json`, `.env`) were previously pushed to a public repository, follow these exact steps to purge sensitive history and ensure zero secrets remain.

### Automated Remediation Script

Run the built-in remediation script:

```bash
npm run purge:history
```

### Manual Fast Remediation (Recommended)

To reset your repository history to a clean, production-grade initial commit without any leaked secrets:

```bash
# 1. Create a clean orphan branch
git checkout --orphan clean-release

# 2. Add all files (the updated .gitignore will automatically exclude secrets)
git add .

# 3. Create the clean commit
git commit -m "chore: initial release with Secret Manager and zero exposed credentials"

# 4. Replace main branch locally
git branch -D main
git branch -m main

# 5. Force-push to GitHub (replaces old history with the clean branch)
git push origin main --force
```

### Rotating Exposed Keys in Google Cloud Console

Whenever an API key has been committed to a public repository, the key must be rotated:

1. Open Google Cloud Credentials Console: `https://console.cloud.google.com/apis/credentials?project=<YOUR_GCP_PROJECT_ID>`
2. Locate the exposed API Key under **API Keys**.
3. Click **Delete** or generate a new restricted key named `reflect-ai-app`.
4. Under **Application restrictions**, set **Website restrictions** to your Firebase Hosting URLs:
   - `https://<YOUR_GCP_PROJECT_ID>.web.app/*`
   - `https://<YOUR_GCP_PROJECT_ID>.firebaseapp.com/*`
   - `http://localhost:3000/*`
5. Store new backend credentials directly in **Google Cloud Secret Manager** (`reflect-ai-env`).
