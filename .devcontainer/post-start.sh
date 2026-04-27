#!/usr/bin/env bash
# Runs every time the Codespace starts (cold start, restart, or attach after stop).
# Boots the autosave daemon in the background under nohup so it survives detached terminals.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

LOG="${AUTOSAVE_LOG:-/tmp/autosave-daemon.log}"
PIDFILE="/tmp/autosave-daemon.pid"

if [[ "${AUTOSAVE_ENABLED:-1}" != "1" ]]; then
  echo "[post-start] AUTOSAVE_ENABLED=0, skipping daemon" | tee -a "$LOG"
  exit 0
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[post-start] autosave-daemon already running (pid $(cat "$PIDFILE"))" | tee -a "$LOG"
  exit 0
fi

chmod +x .devcontainer/autosave-daemon.sh 2>/dev/null || true

nohup bash .devcontainer/autosave-daemon.sh "$REPO_ROOT" >>"$LOG" 2>&1 &
echo $! > "$PIDFILE"
sleep 1
echo "[post-start] autosave-daemon launched (pid $(cat "$PIDFILE")), logs: $LOG"
tail -n 3 "$LOG" 2>/dev/null || true
