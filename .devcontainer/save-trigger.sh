#!/usr/bin/env bash
# Lightweight commit nudge invoked by VS Code task on save.
# Writes a heartbeat that the watcher picks up; if the watcher isn't running
# (e.g. running locally outside a Codespace), falls back to a direct commit.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

PIDFILE="/tmp/autosave-daemon.pid"
HEARTBEAT="/tmp/autosave-heartbeat"

date -u +%FT%TZ > "$HEARTBEAT"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  exit 0
fi

if [[ -x .devcontainer/autosave-daemon.sh ]]; then
  AUTOSAVE_INTERVAL_SECONDS=0 \
  AUTOSAVE_DEBOUNCE_SECONDS=0 \
  bash -c 'source .devcontainer/autosave-daemon.sh; commit_and_push "save-trigger"' 2>/dev/null || true
fi
