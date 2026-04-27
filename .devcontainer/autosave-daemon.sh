#!/usr/bin/env bash
# Codespaces autosave daemon.
# Runs inside the dev container. Two triggers:
#   1. Filesystem change (debounced) — quick save after edits settle.
#   2. Periodic timer (AUTOSAVE_INTERVAL_SECONDS) — guarantees a heartbeat commit
#      even if nothing changed (skipped silently when tree is clean).
# Always pushes to autosave/<base-branch>, never directly to a protected branch.
# Safety: refuses to commit secrets, oversized files, or merge-conflict markers.

set -uo pipefail

LOG="${AUTOSAVE_LOG:-/tmp/autosave-daemon.log}"
INTERVAL="${AUTOSAVE_INTERVAL_SECONDS:-7200}"
DEBOUNCE="${AUTOSAVE_DEBOUNCE_SECONDS:-20}"
PREFIX="${AUTOSAVE_BRANCH_PREFIX:-autosave}"
REMOTE="${AUTOSAVE_REMOTE:-origin}"
PROTECTED="${AUTOSAVE_PROTECTED_BRANCHES:-main,master,production,release}"
MAX_MB="${AUTOSAVE_MAX_FILE_MB:-25}"
WORKDIR="${1:-$PWD}"

cd "$WORKDIR" || { echo "autosave: cannot cd to $WORKDIR"; exit 1; }

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }

acquire_lock() {
  exec 9>/tmp/autosave-daemon.lock
  if ! flock -n 9; then
    log "another autosave daemon already running, exiting"
    exit 0
  fi
}

base_branch() {
  local b
  b="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || echo detached)"
  [[ "$b" == "$PREFIX/"* ]] && b="${b#$PREFIX/}"
  echo "$b"
}

is_protected() {
  local b="$1"
  IFS=',' read -ra arr <<<"$PROTECTED"
  for p in "${arr[@]}"; do [[ "$b" == "$p" ]] && return 0; done
  return 1
}

safety_scan() {
  local issues=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ ! -f "$f" ]] && continue
    local size_mb
    size_mb=$(( $(stat -c%s "$f" 2>/dev/null || stat -f%z "$f") / 1048576 ))
    if (( size_mb > MAX_MB )); then
      log "skip oversized file ($size_mb MB > $MAX_MB MB): $f"
      git reset -q -- "$f"
      issues=$((issues+1))
    fi
    case "$f" in
      *.env|*.env.*|*credentials*|*secret*|*.pem|*.p12|*.keystore|*id_rsa*|*id_ed25519*)
        if grep -qE 'BEGIN (RSA |EC |OPENSSH |PRIVATE)|sk-[a-zA-Z0-9]{20}|aws_secret_access_key|AKIA[0-9A-Z]{16}' "$f" 2>/dev/null; then
          log "REFUSING to stage probable secret: $f"
          git reset -q -- "$f"
          issues=$((issues+1))
        fi
      ;;
    esac
    if grep -qE '^(<{7}|={7}|>{7}) ' "$f" 2>/dev/null; then
      log "skip file with merge conflict markers: $f"
      git reset -q -- "$f"
      issues=$((issues+1))
    fi
  done < <(git diff --cached --name-only 2>/dev/null)
  return $issues
}

ensure_identity() {
  git config user.email >/dev/null 2>&1 || git config user.email "autosave-bot@users.noreply.github.com"
  git config user.name  >/dev/null 2>&1 || git config user.name  "Codespaces Autosave"
}

commit_and_push() {
  local trigger="$1"
  local base auto
  base="$(base_branch)"
  if is_protected "$base"; then
    auto="$PREFIX/$base"
  elif [[ "$base" == "$PREFIX/"* ]]; then
    auto="$base"
  else
    auto="$PREFIX/$base"
  fi

  if [[ -z "$(git status --porcelain)" ]]; then
    log "tree clean, no autosave needed (trigger=$trigger)"
    return 0
  fi

  ensure_identity
  git add -A
  if ! safety_scan; then
    log "safety scan removed risky files from index; continuing with what's left"
  fi

  if [[ -z "$(git diff --cached --name-only)" ]]; then
    log "nothing safe to commit after scan (trigger=$trigger)"
    return 0
  fi

  if [[ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != "$auto" ]]; then
    git checkout -B "$auto" >/dev/null 2>&1 || { log "checkout $auto failed"; return 1; }
  fi

  local files msg
  files="$(git diff --cached --name-only | head -5 | paste -sd ',' -)"
  local count
  count="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  msg="autosave[$trigger]: $count file(s) — $files

triggered: $trigger
host: $(hostname)
base: $base
ts: $(date -u +%FT%TZ)
"
  if git commit -q -m "$msg"; then
    log "committed ($trigger) on $auto: $count files"
  else
    log "commit failed (trigger=$trigger)"
    return 1
  fi

  if git push -q -u "$REMOTE" "$auto" 2>>"$LOG"; then
    log "pushed $auto -> $REMOTE"
  else
    log "push failed (trigger=$trigger) — will retry on next tick"
    return 1
  fi
}

run_periodic() {
  while sleep "$INTERVAL"; do
    commit_and_push "cron-${INTERVAL}s" || true
  done
}

run_watcher() {
  if ! command -v inotifywait >/dev/null 2>&1; then
    log "inotifywait missing, installing inotify-tools…"
    sudo apt-get update -y >/dev/null 2>&1 && sudo apt-get install -y inotify-tools >/dev/null 2>&1 || \
      { log "inotify-tools install failed; relying on cron only"; return; }
  fi
  while true; do
    inotifywait -qq -r -e modify,create,delete,move \
      --exclude '(\.git/|node_modules/|\.next/|dist/|build/|\.cache/|\.pnpm-store/|\.venv/|__pycache__/|/tmp/)' \
      . 2>/dev/null
    sleep "$DEBOUNCE"
    commit_and_push "fs-debounce-${DEBOUNCE}s" || true
  done
}

main() {
  acquire_lock
  log "autosave-daemon starting in $WORKDIR (interval=${INTERVAL}s debounce=${DEBOUNCE}s prefix=$PREFIX)"
  run_periodic &
  PERIODIC_PID=$!
  run_watcher &
  WATCHER_PID=$!
  trap 'log "shutting down"; kill $PERIODIC_PID $WATCHER_PID 2>/dev/null; exit 0' INT TERM
  wait
}

main "$@"
