#!/usr/bin/env bash
#
# Points this clone's git hooks at the tracked .githooks/ directory.
#
# Git hooks live in .git/hooks, which is not version-controlled, so every
# contributor runs this once after cloning:
#
#   bun run hooks:install
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

HOOKS_DIR=".githooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "✗ $HOOKS_DIR not found — are you in the ReflectAI repository root?" >&2
  exit 1
fi

chmod +x "$HOOKS_DIR"/* 2>/dev/null || true

CURRENT="$(git config --get core.hooksPath || true)"
if [ "$CURRENT" = "$HOOKS_DIR" ]; then
  echo "✓ git hooks already point at $HOOKS_DIR"
else
  git config core.hooksPath "$HOOKS_DIR"
  echo "✓ core.hooksPath set to $HOOKS_DIR"
fi

echo
echo "Installed hooks:"
for hook in "$HOOKS_DIR"/*; do
  [ -f "$hook" ] || continue
  printf '  %-12s %s\n' "$(basename "$hook")" "$([ -x "$hook" ] && echo executable || echo 'NOT EXECUTABLE')"
done

cat <<'MSG'

pre-push runs `bun run lint` and `bun run test:security` before every push,
so a broken security guard cannot reach a remote — or a Cloud Run deploy.

Bypass once (deliberately):  SKIP_PREPUSH=1 git push
Uninstall:                   git config --unset core.hooksPath
MSG
