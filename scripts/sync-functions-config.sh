#!/usr/bin/env bash
# Keep supabase/config.toml in sync with supabase/functions/*.
#
# Rule: New functions default to `verify_jwt = true`.
# Public exceptions MUST be in the explicit PUBLIC_ALLOWLIST below.

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

# Explicit allowlist of endpoints that are intentionally verify_jwt = false
# because they verify HMAC signatures/secrets in-code or serve public forms/feeds.
PUBLIC_ALLOWLIST=(
  "consume-invite-token"
  "ics-feed"
  "submit-application"
  "seminar-confirmation"
  "seminar-register"
  "update-application-referral"
  "poke-webhook"
  "calendly-webhook"
  "instagram-webhook"
  "manychat-webhook"
  "readymode-webhook"
  "telegram-webhook"
  "stripe-webhook-lead-purchase"
  "track-email-click"
  "track-email-open"
  "unsubscribe"
  "manager-signup"
  "applicant-checkin"
  "get-public-recruiters"
  "submit-contracting-intake"
  "numbers-reminder"
  "slack-identity-admin"
)

is_public() {
  local name="$1"
  for item in "${PUBLIC_ALLOWLIST[@]}"; do
    if [ "$item" = "$name" ]; then
      return 0
    fi
  done
  return 1
}

added=()
for dir in "$FUNCS_DIR"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  [ "$name" = "_shared" ] && continue
  [ "$name" = "tests" ] && continue

  if ! grep -qE "^\[functions\.${name}\]" "$CONFIG"; then
    if is_public "$name"; then
      printf '\n[functions.%s]\nverify_jwt = false\n' "$name" >> "$CONFIG"
    else
      printf '\n[functions.%s]\nverify_jwt = true\n' "$name" >> "$CONFIG"
    fi
    added+=("$name")
  fi
done

if [ "${#added[@]}" -eq 0 ]; then
  echo "config.toml already in sync with functions/"
else
  echo "Registered ${#added[@]} missing function(s) in config.toml:"
  printf '  - %s\n' "${added[@]}"
fi
