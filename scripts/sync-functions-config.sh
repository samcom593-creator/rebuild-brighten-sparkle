#!/usr/bin/env bash
# Keep supabase/config.toml in sync with supabase/functions/*.
#
# Why: Lovable's deploy pipeline only deploys functions registered in
# config.toml. Creating a new folder under supabase/functions/ is NOT
# enough — the registration stanza must also exist. Miss it once and
# your new function silently 404s forever. This script prevents that.
#
# Behavior: for every directory in supabase/functions/ that isn't _shared,
# append a `[functions.<name>]\nverify_jwt = false` block to config.toml
# if one isn't already present. Idempotent — run as often as you want.
#
# Exit code:
#   0 — no changes (or changes applied cleanly)
#   1 — sync error
#
# Called by:
#   - .github/workflows/deploy-supabase.yml (pre-deploy step)
#   - manually: bash scripts/sync-functions-config.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$REPO_ROOT/supabase/config.toml"
FUNCS_DIR="$REPO_ROOT/supabase/functions"

if [ ! -f "$CONFIG" ]; then
  echo "ERROR: $CONFIG not found" >&2
  exit 1
fi
if [ ! -d "$FUNCS_DIR" ]; then
  echo "ERROR: $FUNCS_DIR not found" >&2
  exit 1
fi

added=()
for dir in "$FUNCS_DIR"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ "$name" = "_shared" ] && continue
  [ "$name" = "tests" ] && continue

  # Grep for exact stanza header — avoid false positives from comments.
  if ! grep -qE "^\[functions\.${name}\]" "$CONFIG"; then
    printf '\n[functions.%s]\nverify_jwt = false\n' "$name" >> "$CONFIG"
    added+=("$name")
  fi
done

if [ "${#added[@]}" -eq 0 ]; then
  echo "config.toml already in sync with functions/"
else
  echo "Registered ${#added[@]} missing function(s) in config.toml:"
  printf '  - %s\n' "${added[@]}"
fi
