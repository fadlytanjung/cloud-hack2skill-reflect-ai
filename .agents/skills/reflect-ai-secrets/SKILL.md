---
name: reflect-ai-secrets
description: Read, update, and deploy ReflectAI's environment secrets, which live as a single Secret Manager secret named `reflect-ai-env` in Google Cloud. Use when working with `.env`, rotating an API key, wiring env vars into Cloud Run, or when a local run fails with a missing `GEMINI_API_KEY` / `MAPS_API_KEY` / webhook URL.
---

# ReflectAI environment secrets

ReflectAI keeps its **entire `.env` file** as the payload of one Secret Manager
secret, rather than one secret per key.

| Parameter | Configuration |
|---|---|
| GCP project | `<YOUR_GCP_PROJECT_ID>` (set via `gcloud config set project <YOUR_GCP_PROJECT_ID>`) |
| Secret name | `reflect-ai-env` (or configured via `SECRET_NAME`) |
| Payload | verbatim contents of `.env` (dotenv format, comments included) |
| Replication | automatic |
| Labels | `app=reflect-ai`, `managed-by=cli` |
| Cloud Run service | `reflectai-journal-reflection-assistant` (or your chosen service name) |

Always pass `--project=<YOUR_GCP_PROJECT_ID>` or set the active gcloud project explicitly:
`export GCP_PROJECT_ID="<YOUR_GCP_PROJECT_ID>"`.

## Never print secret values

Do not `cat .env`, `echo $GEMINI_API_KEY`, or `gcloud secrets versions access`
straight to stdout — tool output is transcript, and the transcript may be
shared. Redirect to a file, or pipe through a checksum/length check.

```bash
# Which keys are populated, without revealing any value
awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ {
  k=$1; v=substr($0, index($0,"=")+1); gsub(/^"|"$/,"",v)
  printf "%-26s %s (len=%d)\n", k, (length(v)>0 ? "SET" : "EMPTY"), length(v)
}'' .env
```

## Pull the secret down to a local `.env`

```bash
gcloud secrets versions access latest \
  --secret=reflect-ai-env \
  --project="${GCP_PROJECT_ID}" > .env
```

`.env` is gitignored (`.gitignore` excludes `.env` and `.env.*` but keeps
`.env.example`). Verify it stays untracked after any pull: `git check-ignore -v .env`.

## Push a new version after editing `.env`

Secret Manager versions are append-only — editing means adding a version, and
`latest` moves to it.

```bash
gcloud secrets versions add reflect-ai-env \
  --project="${GCP_PROJECT_ID}" \
  --data-file=.env
```

Then confirm the upload matches byte-for-byte without printing it:

```bash
gcloud secrets versions access latest --secret=reflect-ai-env \
  --project="${GCP_PROJECT_ID}" 2>/dev/null | shasum -a 256 | awk '{print "remote:", $1}'
shasum -a 256 .env | awk '{print "local: ", $1}'
```

Cloud Run pinned to `:latest` picks up a new version only on the next
**revision**, not immediately. Redeploy (or `gcloud run services update`) to roll
the change out.

## Version housekeeping

```bash
gcloud secrets versions list reflect-ai-env --project="${GCP_PROJECT_ID}"

# Roll back: re-upload an older version's payload as a new one
gcloud secrets versions access 3 --secret=reflect-ai-env \
  --project="${GCP_PROJECT_ID}" > /tmp/rollback.env
gcloud secrets versions add reflect-ai-env --project="${GCP_PROJECT_ID}" \
  --data-file=/tmp/rollback.env && rm -f /tmp/rollback.env

# Retire a leaked version (destroy is irreversible; disable first if unsure)
gcloud secrets versions disable 2 --secret=reflect-ai-env --project="${GCP_PROJECT_ID}"
```

## Keys and who consumes them

Server-side, read from `process.env` in `server.ts`:

- `GEMINI_API_KEY` — `getGenAI()` in `server.ts`; required, the server throws
  without it. Backs `/api/gemini/reflect`, `/reflect-stream`, `/summarize`.
- `MAPS_API_KEY` — `/api/maps/geocode` and `/api/maps/reverse-geocode`.
- `DISCORD_WEBHOOK_URL` — Discord webhook endpoint for outbound reflection alerts.
  Primary notification channel for ReflectAI.
- `WEBHOOK_URL` — optional generic webhook fallback.
- `GCP_PROJECT_ID`, `APP_URL` — deployment identity and URL.

Client-side, inlined into the bundle at build time by Vite via
`src/lib/firebaseConfig.ts`:

- `VITE_FIREBASE_API_KEY` — Explicitly named **`reflect-ai-app`** in Google Cloud
  Console > APIs & Services > Credentials (replaces auto-generated 'Browser key' names).
- `VITE_FIREBASE_PROJECT_ID` — Your Google Cloud Project ID.
- `VITE_FIREBASE_AUTH_DOMAIN` — `<YOUR_GCP_PROJECT_ID>.firebaseapp.com`.
- OAuth 2.0 Client ID — Named **`reflect-ai-app`** with authorized redirect domain
  `https://<YOUR_GCP_PROJECT_ID>.firebaseapp.com`.
- Optional: `VITE_FIREBASE_APP_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_DATABASE_ID` (`reflect-ai-app`).

**Any `VITE_`-prefixed value is baked into public JS and is not secret.** A
Firebase web API key is fine there — it is a project identifier guarded by
Firestore rules and API-key restrictions, not a credential. Never move a
server-side key behind a `VITE_` name to "make it available in the browser."
`firebaseConfig.ts` reads directly from `import.meta.env` (configured via `.env`),
keeping all applet config files strictly out of version control.

## Injecting into Cloud Run

The whole-file secret does **not** expand into separate env vars on its own.
Two workable shapes:

```bash
# A. Mount the file where dotenv already looks for it
gcloud run deploy reflectai-journal-reflection-assistant \
  --source . --region us-west1 --project "${GCP_PROJECT_ID}" \
  --set-secrets=/app/.env=reflect-ai-env:latest \
  --port 3000 --allow-unauthenticated

# B. Expand locally and set discrete env vars at deploy time
set -a; . ./.env; set +a
gcloud run deploy reflectai-journal-reflection-assistant \
  --source . --region us-west1 --project "${GCP_PROJECT_ID}" \
  --set-env-vars="GEMINI_API_KEY=${GEMINI_API_KEY},MAPS_API_KEY=${MAPS_API_KEY}" \
  --port 3000 --allow-unauthenticated
```

Prefer **A** — B writes secret values into the Cloud Run service config and into
shell history.

Mind the path in A. `server.ts` calls `dotenv.config()`, which reads
`.env` relative to the **process working directory** (`/app/.env` for the default buildpack image).

The runtime service account needs read access, granted once:

```bash
PROJECT_NUMBER=$(gcloud projects describe "${GCP_PROJECT_ID}" --format="value(projectNumber)")

gcloud secrets add-iam-policy-binding reflect-ai-env \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${GCP_PROJECT_ID}"
```

## Keep `.env.example` in step

When a key is added or removed, mirror the change in `.env.example` with an
**empty value** and a comment explaining where the real one comes from. It is
the only env file that is committed, and it is what a fresh clone reads.

## Local development

`npm run dev` runs `tsx server.ts` on port 3000 with Vite in middleware mode.
`npm run build` emits `dist/` plus a bundled `dist/server.cjs`; `npm start` runs
that. `npm run lint` is `tsc --noEmit` (strict); `npm test` is `vitest run`.
`npm run test:security` runs just the guard suites — the SSRF webhook check,
admin RBAC, rate limiting, notification egress, and the Firestore rules — and is
what the pre-push hook gates on (`npm run hooks:install`). See the
`tdd-workflow` skill for the red/green loop and the test harness.

Deploys: `npm run deploy:hosting` or `npm run deploy:cloud-run`.

## If a key leaks

1. Revoke and reissue at the source (AI Studio / Cloud Console / Discord), not
   just in Secret Manager — the old value stays valid until revoked upstream.
2. Update `.env`, add a new `reflect-ai-env` version, redeploy.
3. `gcloud secrets versions disable <n>` on the version holding the old value.
4. If it reached git, `scripts/purge-git-history.sh` rewrites history; treat the
   key as burned regardless.
