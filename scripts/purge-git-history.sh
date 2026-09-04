#!/usr/bin/env bash
# ==============================================================================
# ReflectAI - GitHub Commit History Purge & Secret Sanitization Script
# Purpose: Erase exposed credentials and sensitive files from public Git history
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Dynamically resolve Google Cloud Project ID
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "")}"
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  PROJECT_ID="${VITE_FIREBASE_PROJECT_ID:-}"
fi
if [ -z "$PROJECT_ID" ] && [ -f ".env" ]; then
  PROJECT_ID=$(grep -E "^(GCP_PROJECT_ID|VITE_FIREBASE_PROJECT_ID)=" .env | head -n 1 | cut -d'=' -f2 | tr -d '"' || true)
fi
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  PROJECT_ID="<YOUR_GCP_PROJECT_ID>"
fi

PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)" 2>/dev/null || echo "<PROJECT_NUMBER>")}"
SITE_NAME="${FIREBASE_HOSTING_SITE:-${PROJECT_ID}-reflect-ai}"
SECRET_NAME="${SECRET_NAME:-reflect-ai-env}"
DATABASE_ID="${FIREBASE_DATABASE_ID:-reflect-ai-app}"

echo -e "${BLUE}====================================================================${NC}"
echo -e "${BOLD}${CYAN}  ReflectAI: Public Repo Secret Sanitization & History Purge      ${NC}"
echo -e "${BLUE}====================================================================${NC}"
echo ""
echo -e "Target Google Cloud Project : ${GREEN}${PROJECT_ID}${NC}"
echo -e "Runtime Secret Manager Secret : ${GREEN}${SECRET_NAME}${NC}"
echo -e "Firebase Hosting Site        : ${GREEN}${SITE_NAME}${NC}"
echo -e "Firestore Database           : ${GREEN}${DATABASE_ID}${NC}"
echo ""

# ------------------------------------------------------------------------------
# STEP 1: Pre-Flight Check - Scan Working Directory for Sensitive Data Leaks
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[1/4] Scanning working tree for exposed API keys or unignored credentials...${NC}"

LEAK_FOUND=0

# Check for hardcoded Google API keys in source code (excluding .git and node_modules)
EXPOSED_KEYS=$(grep -rnE "AIzaSy[A-Za-z0-9_-]{33}" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude="firebase-applet-config*.json" \
  --exclude="*.sh" 2>/dev/null || true)

if [ -n "$EXPOSED_KEYS" ]; then
  echo -e "${RED}⚠️  POTENTIAL EXPOSED KEY FOUND IN SOURCE CODE:${NC}"
  echo "$EXPOSED_KEYS"
  echo ""
  echo -e "${RED}Please remove hardcoded keys from source code before pushing to a public repository!${NC}"
  LEAK_FOUND=1
else
  echo -e "${GREEN}✓ Zero hardcoded Google API keys detected in source code.${NC}"
fi

# Ensure .env is NOT tracked
if [ -d ".git" ]; then
  TRACKED_SENSITIVE=$(git ls-files .env firebase-applet-config.json firebase-debug.log 2>/dev/null || true)
  if [ -n "$TRACKED_SENSITIVE" ]; then
    echo -e "${YELLOW}Untracking sensitive files from Git index (preserving local copies)...${NC}"
    git rm --cached .env firebase-applet-config.json firebase-debug.log 2>/dev/null || true
    echo -e "${GREEN}✓ Sensitive files removed from staging index.${NC}"
  fi
fi

# ------------------------------------------------------------------------------
# STEP 2: Verify .gitignore Rules
# ------------------------------------------------------------------------------
echo ""
echo -e "${YELLOW}[2/4] Verifying .gitignore configuration...${NC}"

if [ -f ".gitignore" ]; then
  REQUIRED_PATTERNS=(".env" "firebase-applet-config.json" "firebase-debug.log*" "dist/" "node_modules/")
  for pattern in "${REQUIRED_PATTERNS[@]}"; do
    if grep -q "^${pattern}" .gitignore 2>/dev/null || grep -q "${pattern}" .gitignore 2>/dev/null; then
      echo -e "  ${GREEN}✓ Pattern ignored:${NC} ${pattern}"
    else
      echo -e "  ${YELLOW}Adding missing ignore rule:${NC} ${pattern}"
      echo "$pattern" >> .gitignore
    fi
  done
  echo -e "${GREEN}✓ .gitignore is properly configured for public repository safety.${NC}"
else
  echo -e "${RED}Warning: .gitignore file not found!${NC}"
fi

# ------------------------------------------------------------------------------
# STEP 3: History Purge Selection
# ------------------------------------------------------------------------------
echo ""
echo -e "${YELLOW}[3/4] Choose your history sanitization strategy for GitHub:${NC}"
echo -e "  ${BOLD}1) Clean History Reset (RECOMMENDED for public repos)${NC}"
echo "     Replaces the entire commit history with a single, pristine initial commit."
echo "     Completely erases all past diffs, commit messages, and cached objects on GitHub."
echo ""
echo -e "  ${BOLD}2) Deep History Filter (git-filter-repo)${NC}"
echo "     Rewrites all commits to scrub sensitive files while preserving commit chronology."
echo ""
echo -e "  ${BOLD}3) Display Copy-Paste Manual Terminal Commands${NC}"
echo ""

# Default to choice from argument, or prompt user if interactive
if [ -n "$1" ]; then
  choice="$1"
  echo "Using argument choice: $choice"
else
  read -p "Enter choice [1, 2, or 3] (Default: 1): " choice
  choice=${choice:-1}
fi

case $choice in
  1)
    echo ""
    echo -e "${YELLOW}Executing Clean History Reset via Orphan Branch...${NC}"
    
    if [ ! -d ".git" ]; then
      echo -e "${YELLOW}Notice: No .git repository in current container folder.${NC}"
      echo "Initializing a fresh sanitized Git repository..."
      git init
      git branch -m main
    fi

    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "main")
    CURRENT_BRANCH=${CURRENT_BRANCH:-main}

    # Step A: Create an orphan branch with zero parent commits
    echo "• Creating detached orphan branch (clean-release)..."
    git checkout --orphan clean-release 2>/dev/null || git checkout -b clean-release

    # Step B: Remove any previously staged cached sensitive files
    echo "• Unstaging any cached secret files..."
    git rm -r --cached .env .env.* firebase-applet-config.json firebase-debug.log* dist/ 2>/dev/null || true

    # Step C: Stage only clean files matching .gitignore
    echo "• Staging sanitized codebase..."
    git add .

    # Step D: Create clean single initial commit
    echo "• Creating sanitized initial production release commit..."
    git commit -m "chore: initial production release with Google Cloud Secret Manager integration and zero secrets"

    # Step E: Replace current branch
    echo "• Setting default branch to ${CURRENT_BRANCH}..."
    git branch -D "$CURRENT_BRANCH" 2>/dev/null || true
    git branch -m "$CURRENT_BRANCH"

    echo ""
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "${GREEN}✓ Local Git history has been completely purged and sanitized!       ${NC}"
    echo -e "${GREEN}====================================================================${NC}"
    echo ""
    echo -e "${BOLD}${CYAN}To push this clean history to your public GitHub repository:${NC}"
    echo ""
    echo -e "  ${BOLD}git push origin ${CURRENT_BRANCH} --force${NC}"
    echo ""
    ;;

  2)
    echo ""
    echo -e "${YELLOW}Executing git-filter-repo scrub...${NC}"

    if ! command -v git-filter-repo &> /dev/null; then
      echo -e "${RED}git-filter-repo is not installed.${NC}"
      echo "Install via: pip install git-filter-repo"
      echo "Alternatively, use Option 1 (Clean History Reset)."
      exit 1
    fi

    git-filter-repo --invert-paths \
      --path .env \
      --path firebase-applet-config.json \
      --path firebase-debug.log \
      --force

    echo ""
    echo -e "${GREEN}✓ git-filter-repo rewrite finished successfully.${NC}"
    echo "Re-link your GitHub remote and force push:"
    echo "  git remote add origin <GITHUB_REPO_URL>"
    echo "  git push origin --force --all"
    echo "  git push origin --force --tags"
    ;;

  3|*)
    echo ""
    echo -e "${CYAN}====================================================================${NC}"
    echo -e "${BOLD}Manual Terminal Commands to Purge Public Git History:${NC}"
    echo -e "${CYAN}====================================================================${NC}"
    echo ""
    echo "# 1. Create a clean orphan branch with zero history"
    echo "git checkout --orphan clean-main"
    echo ""
    echo "# 2. Unstage any cached secret files"
    echo "git rm -r --cached .env firebase-applet-config.json firebase-debug.log* dist/ 2>/dev/null || true"
    echo ""
    echo "# 3. Add all clean project files"
    echo "git add ."
    echo ""
    echo "# 4. Commit clean initial state"
    echo "git commit -m 'chore: initial production release with Secret Manager integration'"
    echo ""
    echo "# 5. Replace main branch"
    echo "git branch -D main 2>/dev/null || true"
    echo "git branch -m main"
    echo ""
    echo "# 6. Force-push the sanitized single commit to GitHub"
    echo "git push origin main --force"
    echo ""
    ;;
esac

# ------------------------------------------------------------------------------
# STEP 4: Post-Sanitization Secret Rotation & Alignment Checklist
# ------------------------------------------------------------------------------
echo ""
echo -e "${BLUE}====================================================================${NC}"
echo -e "${BOLD}${YELLOW}[4/4] Mandatory Cloud Credentials & Secret Alignment Checklist       ${NC}"
echo -e "${BLUE}====================================================================${NC}"
echo ""
echo -e "${BOLD}1. Rotate Any Previously Exposed Keys in Google Cloud Console:${NC}"
echo "   Since the repository is public, any key previously committed to Git"
echo "   should be rotated immediately in Google Cloud Console:"
echo "   • Console URL: https://console.cloud.google.com/apis/credentials?project=${PROJECT_ID}"
echo "   • Key Name   : reflect-ai-app"
echo "   • Restrictions: Add Website Restrictions -> 'https://${SITE_NAME}.web.app/*'"
echo "                                            -> 'https://${PROJECT_ID}.firebaseapp.com/*'"
echo ""
echo -e "${BOLD}2. Store Operational Secrets in Google Cloud Secret Manager (${SECRET_NAME}):${NC}"
echo "   All server-side secrets (GEMINI_API_KEY, MAPS_API_KEY, DISCORD_WEBHOOK_URL)"
echo "   are mounted into Cloud Run via Secret Manager secret '${SECRET_NAME}'."
echo ""
echo "   gcloud secrets versions add ${SECRET_NAME} --data-file=.env --project=${PROJECT_ID}"
echo ""
echo -e "${BOLD}3. Ensure Cloud Run Service Account has Secret Accessor Role:${NC}"
echo "   gcloud secrets add-iam-policy-binding ${SECRET_NAME} \\"
echo "     --member=\"serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com\" \\"
echo "     --role=\"roles/secretmanager.secretAccessor\" \\"
echo "     --project=${PROJECT_ID}"
echo ""
echo -e "${GREEN}Sanitization procedure complete.${NC}"
