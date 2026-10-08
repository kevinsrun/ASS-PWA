#!/usr/bin/env bash
# Vercel Ignored Build Step Script
# Exit 0: CANCEL / SKIP deployment
# Exit 1: PROCEED with deployment

set -euo pipefail

COMMIT_MSG="${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --pretty=%B 2>/dev/null || echo '')}"

# 1. Skip if commit message contains skip tags
if echo "$COMMIT_MSG" | grep -qiE "\[skip ci\]|\[ci skip\]|\[skip vercel\]|\[vercel skip\]|skip-ci"; then
  echo "[-] Commit message contains skip flag ($COMMIT_MSG). Skipping Vercel deployment."
  exit 0
fi

# 2. Determine previous commit base
BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$BASE" ] || ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    BASE="HEAD^"
  else
    # Fresh shallow clone or root commit - proceed with build
    echo "[+] Initial or shallow commit detected. Proceeding with Vercel deployment."
    exit 1
  fi
fi

# 3. Check what files changed
CHANGED_FILES=$(git diff --name-only "$BASE" HEAD 2>/dev/null || echo "ALL")

if [ "$CHANGED_FILES" = "ALL" ]; then
  echo "[+] Unable to determine diff. Proceeding with Vercel deployment."
  exit 1
fi

if [ -z "$CHANGED_FILES" ]; then
  echo "[-] No files changed between $BASE and HEAD. Skipping Vercel deployment."
  exit 0
fi

# 4. Check if any application or configuration files were changed
APP_CHANGES=$(echo "$CHANGED_FILES" | grep -E '^(src/|public/|package\.json|package-lock\.json|next\.config\.|tsconfig\.json|postcss\.config\.|tailwind\.config\.|vercel\.json)' || true)

if [ -n "$APP_CHANGES" ]; then
  echo "[+] Application code or build configuration changed:"
  echo "$APP_CHANGES" | head -n 10
  echo "[+] Proceeding with Vercel deployment."
  exit 1
fi

# If changes exist but only touch docs, scripts, migrations, github workflows, etc.
echo "[-] Only documentation, test scripts, or migrations changed ($CHANGED_FILES). Skipping Vercel deployment."
exit 0
