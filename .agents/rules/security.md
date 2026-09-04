---
description: Security invariants for ReflectAI — secrets handling, SSRF, RBAC, prompt injection. Always applies.
trigger: always_on
---

# Security rules

## Secrets

- The real `.env` is **never** committed; it is one Secret Manager secret named
  `reflect-ai-env`. Use the `reflect-ai-secrets` skill for anything involving it.
- **Never print a secret value.** No `cat .env`, no `echo $GEMINI_API_KEY`, no
  `gcloud secrets versions access` to stdout. Redirect to a file, or compare
  checksums. Tool output becomes transcript, and transcripts get shared.
- `VITE_`-prefixed variables are compiled into the public browser bundle. A
  Firebase web API key belongs there; a Gemini or Maps key never does.
- When a key is added or removed, mirror it in `.env.example` with an empty
  value and a comment saying where the real one comes from.

## Outbound requests (SSRF — OWASP A10)

Every caller-influenced URL passes `isValidWebhookUrl` from
`src/server/lib/security.ts` **before** `fetch`. HTTPS only; loopback,
link-local, `169.254.169.254`, `metadata.google.internal`, and RFC1918 ranges
are refused. Do not add a bypass — extend the blocklist and its test instead.

Never echo a full user-supplied webhook URL back in a response or a log; the
path segment is a bearer credential. `describeWebhookTarget` exists for this.

## Access control

Administrator status is predefined data: `users/{uid}.role == 'admin'` in
Firestore, seeded with `scripts/set-user-role.sh`.

- Every `/api/admin/*` route is mounted behind `verifyAdmin`.
- **Identity comes from a verified Firebase ID token, never a request header.**
  The role is looked up by the uid *inside* that token.
- **Never trust a header for privilege.** `x-admin-role`, `x-admin-email` and
  `x-user-email` were each a working escalation path on a public service. So was
  a shared static token, reading an unverified JWT, and privileging a hardcoded
  email address (which also shipped in the public bundle).
- **Clients cannot write `users/{uid}.role`** — `firestore.rules` denies it on
  create and update. Otherwise an account grants itself the role that governs it.
- Every grant and every denial is written to the audit log.
- A denied response body carries `{ error }` and nothing else, with the same
  message whether the token was absent, forged, or simply not an admin's.
- Firestore entries are owner-bound: `request.auth.uid == userId`.
- The client-side `role` is a UI hint. It never grants anything.

`ALLOW_INSECURE_ADMIN=1` bypasses authentication for local development only; it
is ignored in production.

## Untrusted input

Treat two things as hostile: the request body, and the model's output.

- Reflection text is data, never instructions. The system prompt says so
  explicitly; keep that line.
- Anything leaving the process for a webhook, Discord, or email goes through
  `sanitizeNotificationPayload` (OWASP LLM02) — injection directives redacted,
  markup stripped, length capped.
- Never render model output as raw HTML. `MarkdownRenderer` deliberately has no
  `rehype-raw`.

## Changing a guard

A change to `firestore.rules`, `src/server/lib/security.ts`, or
`src/server/lib/rbac.ts` requires a test in the same commit that demonstrates
the new boundary. The pre-push hook runs these suites before every push.
