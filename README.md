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

### Or Manually via gcloud & Cloud Build:
```bash
# 1. Build production container using Dockerfile & Cloud Build
gcloud builds submit --tag gcr.io/<YOUR_GCP_PROJECT_ID>/reflectai-journal-reflection-assistant:latest .

# 2. Deploy container image to Cloud Run with Secret Manager binding
gcloud run deploy reflectai-journal-reflection-assistant \
  --image gcr.io/<YOUR_GCP_PROJECT_ID>/reflectai-journal-reflection-assistant:latest \
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

```bash
npm install
npm run hooks:install   # once per clone - installs the pre-push test gate
npm run dev
```

Visit `http://localhost:3000` to interact with the application.

### Project layout

`server.ts` is a thin entrypoint. All request handling lives in `src/server/`,
where `createApp(deps)` builds the Express surface with every external
dependency injected -- environment, Gemini client, audit log, notification
history, rate limiter, `fetch`, and the clock:

```
server.ts                 dotenv, createApp, Vite/static middleware, listen
src/server/app.ts         createApp(deps) - every route
src/server/lib/           pure, unit-tested logic
  security.ts               SSRF guard, coordinate bounds, egress sanitizer
  rbac.ts                   admin identity resolution + Express middleware
  rateLimit.ts              fixed-window limiter with an injectable clock
  auditLog.ts               bounded audit trail
  prompts.ts                persona wiring, history mapping, insight parsing
  gemini.ts                 model fallback ladder, SSE framing
  notifications.ts          webhook / Discord payload shaping + history
  maps.ts                   geocode URLs, response parsing, offline fallback
  clientConfig.ts           public bootstrap payload
```

Add an endpoint by putting its logic in a `src/server/lib/` module with a unit
test, wiring the route in `src/server/app.ts`, then adding an integration test
under `test/api/`. Nothing goes directly into `server.ts`.

---

## 9. Testing

```bash
npm test                # full suite
npm run test:watch      # red/green loop while developing
npm run test:security   # guard suites only (what the pre-push hook runs)
npm run test:coverage   # report to coverage/index.html + enforce thresholds
npm run lint            # tsc --noEmit, strict
```

| Location | Environment | Covers |
|---|---|---|
| `src/server/lib/*.test.ts` | node | pure logic, exhaustive edge cases |
| `test/api/*.test.ts` | node + supertest | HTTP status, bodies, headers, egress |
| `src/lib/*.test.ts` | jsdom | auth error mapping, payload hygiene, offline buffer |
| `src/components/__tests__/*.test.tsx` | jsdom + Testing Library | rendering, interaction |
| `src/App.test.tsx` | jsdom | auth gating, entry lifecycle, sync status |
| `test/firestore-rules.test.ts` | node | static guard on `firestore.rules` |

No test touches the network, needs an API key, sleeps, or reads your `.env`.
`test/helpers/createTestApp.ts` stubs Gemini, `fetch`, and the clock, and
exposes `fetchCalls` so a test can assert exactly what would have left the
process. `vitest.config.ts` points `envDir` at an empty fixture directory so
local credentials can never change a result.

Component and browser tests opt into jsdom with a `// @vitest-environment jsdom`
docblock on line 1; everything else runs in node.

### Pre-push hook

```bash
npm run hooks:install
```

Sets `core.hooksPath` to the tracked `.githooks/` directory. `pre-push` runs
`npm run lint` and `npm run test:security` -- the SSRF webhook guard, admin
RBAC, rate limiting, notification egress sanitization, and the Firestore rules
-- so a broken security boundary cannot reach a remote, or a Cloud Run deploy.

Bypass once, deliberately: `SKIP_PREPUSH=1 git push`. If the hook is in the way,
the fix is a passing test.

### Agent configuration

`AGENTS.md` at the repo root is the shared context for any coding agent.
Antigravity rules live in `.agents/rules/` (testing, security, conventions) and
skills in `.agents/skills/<name>/SKILL.md` (`reflect-ai-secrets`,
`tdd-workflow`). These are committed. Claude Code's `.claude/` is gitignored, so
each contributor can use whichever assistant they prefer without the two
configurations drifting.

---

## 10. GitHub Security: Purging Leaked Keys & History Remediation

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
