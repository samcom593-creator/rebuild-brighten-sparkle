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
  # MP-441 — RECOVERED FROM PROD, not a new decision. These two are ACTIVE in
  # the project today with verify_jwt=false (read live from the management API
  # 2026-09-05: billing-portal-redirect v145, daily-brief v138, apex-ai-nudge
  # v137). They are listed here BEFORE their source is recovered into
  # supabase/functions/, because the order matters and gets this backwards
  # exactly once: this script defaults an unlisted directory to
  # verify_jwt = true, the deploy workflow pushes only the functions a commit
  # changed, so the very commit that restores billing-portal-redirect's source
  # would also flip a LIVE public endpoint to JWT-required. That endpoint
  # generates Stripe billing-portal sessions from ?t=<uuid> rescue links, so
  # the break would land on customers trying to pay, and nothing in this repo
  # would say why. daily-brief and apex-ai-nudge already carry an explicit
  # verify_jwt = false stanza in config.toml so this script skips them; they
  # are named here so the allowlist is the one place that answers "is this
  # endpoint public", rather than the answer living in two files that can drift.
  #
  # THIS IS A RECORD OF EXPOSURE, NOT AN ENDORSEMENT. daily-brief is proven
  # readable with no Authorization header at all (see the ledger for the live
  # 200). The fix is NOT to delete these lines — both crons authenticate with
  # apex_bot_token, which is not a JWT, so verify_jwt = true refuses them and
  # kills the 7am brief and the applicant nudge cadence. It is an in-code
  # bearer check, which is what "verify secrets in-code" above already means.
  "billing-portal-redirect"
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
