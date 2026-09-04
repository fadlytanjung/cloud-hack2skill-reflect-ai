#!/usr/bin/env bash
# ==============================================================================
# ReflectAI - Secret scanner for git objects and the working tree
#
# Why this exists: `git rev-list --all` only walks *reachable* objects. This repo
# has had its history rewritten twice, and the pre-rewrite commits are still in
# the object store -- and still fetchable from GitHub by SHA, because rewriting
# history does not remove what was already pushed. An audit that scans only the
# current branch would have reported "clean" while a hardcoded API key sat in an
# orphaned blob. `--all` scans every object, reachable or not.
#
# Modes:
#   (no args)          commits about to be pushed, read from stdin (pre-push hook)
#   --range A..B       an explicit commit range
#   --all              EVERY object in the store, including orphaned ones (audit)
#   --worktree         the working tree only, honouring .gitignore
#
# Exit codes: 0 clean, 1 findings, 2 usage/environment error.
#
# Values are never printed. Findings show the pattern class, the file, and a
# short SHA-256 fingerprint so a key can be identified without disclosing it.
# ==============================================================================

set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "audit-git-secrets: not inside a git repository" >&2; exit 2; }

ALLOWLIST="scripts/secret-allowlist.txt"

# Patterns that indicate a real credential. Deliberately narrow: a pattern that
# fires on every long string trains people to ignore the scanner.
#   name|regex
PATTERNS=(
  "gemini_api_key|AQ\.[A-Za-z0-9_-]{25,}"
  "google_api_key|AIzaSy[A-Za-z0-9_-]{33}"
  "discord_webhook|discord(app)?\.com/api/webhooks/[0-9]{15,}/[A-Za-z0-9_-]{40,}"
  "private_key_pem|-----BEGIN [A-Z ]*PRIVATE KEY-----"
  "service_account|\"type\"[[:space:]]*:[[:space:]]*\"service_account\""
  "gcp_sa_private_key|\"private_key_id\"[[:space:]]*:"
  "github_pat|gh[pousr]_[A-Za-z0-9]{36,}"
  "slack_token|xox[abposr]-[A-Za-z0-9-]{10,}"
  "aws_access_key|AKIA[0-9A-Z]{16}"
  "openai_key|sk-[A-Za-z0-9]{40,}"
)

fingerprint() {
  # 16 hex chars of SHA-256: enough to identify a value, useless as a credential.
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | cut -c1-16
  else
    printf '%s' "$1" | sha256sum | cut -c1-16
  fi
}

is_allowlisted() {
  [ -f "$ALLOWLIST" ] || return 1
  grep -qE "^[[:space:]]*sha256:$(fingerprint "$1")([[:space:]]|$)" "$ALLOWLIST"
}

# Findings accumulate in files, not variables: every scan loop below runs inside
# a pipeline, so a counter incremented there would be discarded with the
# subshell and the script would exit 0 while printing failures.
FINDINGS_FILE="$(mktemp)"
ALLOWED_FILE="$(mktemp)"
trap 'rm -f "$FINDINGS_FILE" "$ALLOWED_FILE"' EXIT
export FINDINGS_FILE ALLOWED_FILE

# Scans one stream of text. $1 = label shown in output.
scan_stream() {
  local label="$1" content
  content="$(cat)"
  [ -n "$content" ] || return 0

  local entry name regex match
  for entry in "${PATTERNS[@]}"; do
    name="${entry%%|*}"
    regex="${entry#*|}"
    while IFS= read -r match; do
      [ -n "$match" ] || continue
      if is_allowlisted "$match"; then
        printf '%s\n' "$name" >> "$ALLOWED_FILE"
        continue
      fi
      printf '  \033[31m✗\033[0m %-20s %s  [sha256:%s]\n' \
        "$name" "$label" "$(fingerprint "$match")" >&2
      printf '%s\t%s\n' "$name" "$label" >> "$FINDINGS_FILE"
    done < <(printf '%s' "$content" | LC_ALL=C grep -aIoE "$regex" 2>/dev/null | sort -u)
  done
}

scan_commit_range() {
  local count
  count=$(git rev-list --count "$@" 2>/dev/null || echo 0)
  echo "▸ Scanning ${count:-0} commit(s) in: $*"
  [ "${count:-0}" -gt 0 ] || return 0
  # Every blob introduced anywhere in the range, deduplicated.
  git rev-list --objects "$@" 2>/dev/null | awk 'NF>1 {print $1, $2}' \
    | while read -r sha path; do
        [ "$(git cat-file -t "$sha" 2>/dev/null)" = "blob" ] || continue
        git cat-file -p "$sha" 2>/dev/null | scan_stream "$path"
      done
}

scan_all_objects() {
  local blobs total
  blobs=$(mktemp)
  git cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype)' \
    | awk '$2=="blob" {print $1}' > "$blobs"
  total=$(wc -l < "$blobs" | tr -d ' ')
  echo "▸ Scanning ALL $total blobs in the object store (reachable + orphaned)"
  local path
  while read -r sha; do
    # Name the blob by any path it ever had, for a readable report.
    path=$(git rev-list --objects --all 2>/dev/null | awk -v s="$sha" '$1==s {print $2; exit}')
    git cat-file -p "$sha" 2>/dev/null | scan_stream "${path:-orphaned-blob/$(echo "$sha" | cut -c1-8)}"
  done < "$blobs"
  rm -f "$blobs"
}

scan_worktree() {
  echo "▸ Scanning the working tree (gitignored files excluded)"
  git ls-files -co --exclude-standard \
    | while read -r f; do
        [ -f "$f" ] || continue
        case "$f" in *bun.lock|*package-lock.json|*.png|*.jpg|*.svg|*.map|*.ico) continue ;; esac
        scan_stream "$f" < "$f"
      done
}

MODE="${1:-hook}"
echo "ReflectAI secret audit"

case "$MODE" in
  --all)      scan_all_objects ;;
  --worktree) scan_worktree ;;
  --range)
    [ $# -ge 2 ] || { echo "usage: $0 --range A..B" >&2; exit 2; }
    shift
    scan_commit_range "$@"
    ;;
  hook)
    # pre-push feeds: <local ref> <local sha> <remote ref> <remote sha>
    ZERO="0000000000000000000000000000000000000000"
    SAW_INPUT=0   # stdin carried ref updates at all
    ANY=0         # at least one of them had commits to scan
    while read -r _lref lsha _rref rsha; do
      [ -n "${lsha:-}" ] || continue
      SAW_INPUT=1
      # A deletion pushes nothing, so there is nothing to scan.
      [ "$lsha" = "$ZERO" ] && continue
      ANY=1
      if [ "${rsha:-$ZERO}" = "$ZERO" ]; then
        # New branch on the remote: everything it introduces that no remote has.
        # Separate arguments, not one quoted string.
        if git rev-parse --verify --quiet refs/remotes >/dev/null 2>&1 \
           || [ -n "$(git for-each-ref --format='%(refname)' refs/remotes 2>/dev/null)" ]; then
          scan_commit_range "$lsha" --not --remotes
        else
          # No remote refs at all: the whole branch is new.
          scan_commit_range "$lsha"
        fi
      else
        scan_commit_range "$rsha..$lsha"
      fi
    done
    if [ "$ANY" != "1" ]; then
      if [ "$SAW_INPUT" = "1" ]; then
        echo "▸ Nothing to scan (deletion-only push)"
      else
        # Invoked by hand rather than by the hook.
        echo "▸ No refs on stdin; scanning the working tree instead"
        scan_worktree
      fi
    fi
    ;;
  *) echo "usage: $0 [--all | --worktree | --range A..B]" >&2; exit 2 ;;
esac

FINDINGS=$(wc -l < "$FINDINGS_FILE" | tr -d ' ')
ALLOWED=$(wc -l < "$ALLOWED_FILE" | tr -d ' ')

echo
[ "$ALLOWED" -gt 0 ] && echo "ℹ $ALLOWED match(es) allowlisted in $ALLOWLIST"

if [ "$FINDINGS" -gt 0 ]; then
  cat >&2 <<MSG
✗ $FINDINGS secret-shaped value(s) found.

Values are not printed. Identify one by its sha256 prefix:

  git cat-file -p <blob> | grep -c <pattern>

If a finding is a genuine credential:
  1. Rotate it at the source first. It is compromised the moment it is pushed,
     and rewriting history does NOT remove it from a remote that already has it.
  2. Remove it from the working tree and add the file to .gitignore.
  3. Only then consider scripts/purge-git-history.sh.

If it is a public identifier by design (a referrer-restricted Firebase browser
key, for instance), record its fingerprint in $ALLOWLIST with a comment saying
why it is safe.
MSG
  exit 1
fi

echo "✓ No secrets found"
