#!/usr/bin/env bash
# force-deploy.sh — trigger the Supabase deploy workflow on demand.
#
# Gives Claude (or you) a reliable button to fire a redeploy from this
# terminal, bypassing Lovable's schedule entirely.
#
# Prerequisites (one-time):
#   1. In the repo's GitHub settings → Secrets → Actions, add:
#        SUPABASE_ACCESS_TOKEN   (from supabase.com/dashboard/account/tokens)
#        SUPABASE_DB_PASSWORD    (from project settings → database)
#   2. `gh auth login` on this machine (or export GH_TOKEN)
#
# Usage:
#   ./scripts/force-deploy.sh                 # deploy all functions + migrations
#   ./scripts/force-deploy.sh apex-exec       # deploy just one function
#   ./scripts/force-deploy.sh --no-migrate    # skip db push
set -euo pipefail

ONLY=""
SKIP_MIG="false"
for arg in "$@"; do
  case "$arg" in
    --no-migrate) SKIP_MIG="true" ;;
    --help|-h)    sed -n '2,20p' "$0"; exit 0 ;;
    *)            ONLY="$arg" ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "❌ gh CLI not installed. brew install gh" >&2
  exit 1
fi

echo "→ triggering deploy-supabase.yml (only=$ONLY skip_migrations=$SKIP_MIG)"
gh workflow run deploy-supabase.yml \
  -f only_function="$ONLY" \
  -f skip_migrations="$SKIP_MIG"

sleep 3
RUN_ID=$(gh run list --workflow=deploy-supabase.yml --limit 1 --json databaseId --jq '.[0].databaseId')
echo "→ watching run $RUN_ID"
gh run watch "$RUN_ID" --exit-status
