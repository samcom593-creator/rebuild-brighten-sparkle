#!/usr/bin/env bash
# One-time setup when the Codespace is first created (or rebuilt).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

echo "[post-create] installing inotify-tools + jq…"
sudo apt-get update -y >/dev/null 2>&1 || true
sudo apt-get install -y inotify-tools jq >/dev/null 2>&1 || true

echo "[post-create] making autosave scripts executable…"
chmod +x .devcontainer/autosave-daemon.sh \
         .devcontainer/post-start.sh \
         .devcontainer/save-trigger.sh 2>/dev/null || true

echo "[post-create] configuring git autosave identity…"
git config user.email "${GIT_AUTHOR_EMAIL:-autosave-bot@users.noreply.github.com}"
git config user.name  "${GIT_AUTHOR_NAME:-Codespaces Autosave}"
git config pull.rebase true
git config push.autoSetupRemote true
git config rerere.enabled true
git config core.autocrlf input

echo "[post-create] installing dependencies (best-effort)…"
if [[ -f package.json ]]; then
  if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile || pnpm install || true
  elif [[ -f yarn.lock ]] && command -v yarn >/dev/null 2>&1; then
    yarn install --frozen-lockfile || yarn install || true
  elif [[ -f package-lock.json ]]; then
    npm ci || npm install || true
  else
    npm install || true
  fi
fi

echo "[post-create] done."
