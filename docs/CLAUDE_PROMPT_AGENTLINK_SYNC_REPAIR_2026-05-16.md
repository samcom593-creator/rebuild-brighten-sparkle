# Claude Prompt: AgentLink / InsuraCloud Sync Repair

You are working in `/Users/samjames/projects/rebuild-brighten-sparkle` on the APEX Financial repo. This is an authorized agency data export/sync repair between APEX, Agent Link / InsuraCloud, Supabase, and Discord notifications. Do not expose secrets, client records, cookies, tokens, webhook URLs, or full PII in chat or commits.

## Current Situation

Sam and the agency partner are tired and need this stabilized fast. The main symptoms are:

- Duplicate/noisy deal automations.
- Discord firing for backfilled or old deal data.
- AgentLink / InsuraCloud book-of-business data not fully normalized into APEX.
- APEX has back data and duplicated deals.
- Sync health is confusing because multiple transports exist at once.

There is also a starter worker archive at:

`/Users/samjames/Library/Messages/Attachments/ce/14/at_0_84A7B79F-53B9-4763-98FF-0936C05A4C84/insuracloud-agency-sync-starter.tar.gz`

Codex unpacked it to `/Users/samjames/agency_sync_starter_audit`. That starter is useful as reference only. The real app is the Apex repo above.

## Live Aggregate Audit From 2026-05-16 04:57 CT

Queried via authorized `bot-sql`, aggregate/schema data only:

- `public.deals` total: `1042`.
- Source counts:
  - `agent_link`: `1032` rows, `$1,392,044.64` ALP.
  - `apex`: `10` rows, `$9,104.04` ALP.
- Status counts:
  - `NULL`: `1032` rows, all `agent_link`.
  - `submitted`: `10` rows.
- Duplicate `(agent_id, policy_number)` groups: `80`.
- Rows involved in those duplicate groups: `302`.
- Duplicate `external_deal_id` groups: `0`.
- Placeholder client rows: `2`.
- Active agents missing `insuracloud_user_id`: `55`.
- Active carriers missing `insuracloud_carrier_id`: `1`.
- Last 24h automation burst:
  - `deal-insuracloud-push`: `297` automation logs.
  - `deal-broadcast`: `61` automation logs.
  - `bot_alerts`: `297` `warn` rows from trigger source.
- Active `cron.job` still has `agentlink-live-pull` running `SELECT public.agentlink_live_pull();` every 5 minutes.
- `agentlink_live_pull()` currently has EXECUTE granted to `PUBLIC`, `anon`, `authenticated`, `postgres`, and `service_role`.
- `agentlink_sync_log` latest rows are stale from `2026-05-05`, even though newer sync-health surfaces show other InsuraCloud activity.
- `v_sync_health` shows `agentlink_cookie_pull` stale since `2026-05-05` and `supabase_pg_cron` as asleep/never-run.

## Dirty Local Repo State

Do not overwrite user/partner edits. Current unstaged files:

- `.github/workflows/external-cron-backup.yml`
- `src/pages/AgentLinkSync.tsx`
- `supabase/functions/agentlink-cookie-sync/index.ts`
- `supabase/migrations/20260516093000_agentlink_truth_sync_repair.sql`

Inspect these before editing:

```bash
git status --short
git diff -- .github/workflows/external-cron-backup.yml src/pages/AgentLinkSync.tsx supabase/functions/agentlink-cookie-sync/index.ts
sed -n '1,360p' supabase/migrations/20260516093000_agentlink_truth_sync_repair.sql
```

## Root Causes To Fix

1. `deals_trigger_insuracloud_push()` is live without a source guard.
   - Current live function only skips `synced_to_insuracloud_at IS NOT NULL` or `status = 'draft'`.
   - Because the imported `agent_link` rows have `status = NULL`, they are not skipped.
   - Result: inbound AgentLink deals get pushed back outbound to InsuraCloud, causing `deal-insuracloud-push` spam and sync-error alerts.

2. `agent_link` deal statuses are NULL.
   - `1032` imported rows need `status` and `pipeline_stage` backfilled from `policy_status_standard` / upstream status, defaulting to `submitted` only when upstream is absent.

3. Duplicate policy rows exist.
   - There is a unique index on `external_deal_id`, but no unique guard on canonical `(agent_id, policy_number)`.
   - Agent Link external IDs can rotate or be missing. Use normalized `policy_number` as the stable dedupe key per agent.

4. Multiple sync transports are competing.
   - Local changes move toward `agentlink-cookie-sync` Edge Function.
   - The new local migration still schedules `public.agentlink_live_pull()` every 5 minutes.
   - Decide on one writer. Prefer the Edge Function if that is the current direction, then unschedule the DB pg_net pull.

5. `agentlink_live_pull()` is over-granted.
   - It reads the saved AgentLink cookie and writes deals. It must not be callable by `PUBLIC`, `anon`, or normal `authenticated`.
   - Manual UI runs should call the Edge Function with admin/user auth, not the raw RPC.

6. Discord/backfill guards are fragile.
   - `is_fresh_deal_close(effective_date, posted_at, created_at)` is better than old guards, but imports can synthesize `effective_date` or `posted_at` as "today", making historical rows look fresh.
   - During repair/backfill, suppress Discord and outbound pushes for `source = 'agent_link'` unless explicitly whitelisted and idempotent.

7. `run_automation_job()` logs false success.
   - It marks success after queueing `net.http_post`; it does not collect the actual Edge Function response.
   - Treat `automation_run_log.status = success` as "request queued", not final truth, unless the Edge Function updates the log or pg_net response is collected.

8. `insuracloud-outbox` is configured `verify_jwt = false` and has no in-function auth check.
   - Add Bearer token / admin user validation like `insuracloud-sync` and `agentlink-cookie-sync`.

9. The starter worker has design bugs if reused.
   - No push lock or row-claiming, so cron/manual/multi-instance push can duplicate rows.
   - `/outbox/enqueue`, `/sync/run/push`, `/sync/run/pull`, `/push-log` are unauthenticated.
   - HTTP push errors mark rows `sent_at`, so they do not retry.
   - No unique pending outbox key on `(entity_type, external_id)`.
   - `better-sqlite3@11.x` failed to install locally under Node `v26.0.0`; pin Node 20/22 or upgrade the driver path.

## Execution Order

### 0. Stop The Noise First

Before any backfill/import, prevent inbound AgentLink rows from firing outbound pushes or Discord.

Patch and apply a migration that changes `deals_trigger_insuracloud_push()` to only push real APEX-originated deals:

```sql
CREATE OR REPLACE FUNCTION public.deals_trigger_insuracloud_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF COALESCE(NEW.source, 'apex') <> 'apex' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS NULL OR NEW.status = 'draft' OR NEW.synced_to_insuracloud_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.run_automation_job(
    'deal-insuracloud-push',
    'insuracloud-outbox',
    jsonb_build_object('deal_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
```

Also patch `trg_fn_deal_broadcast()` so bulk inbound repairs do not notify:

```sql
CREATE OR REPLACE FUNCTION public.trg_fn_deal_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF COALESCE(NEW.source, 'apex') = 'apex' THEN
    INSERT INTO public.deal_sync_queue (deal_id, direction, status)
    VALUES (NEW.id, 'outbound', 'pending')
    ON CONFLICT DO NOTHING;

    IF public.is_fresh_deal_close(NEW.effective_date, NEW.posted_at, NEW.created_at) THEN
      PERFORM public.run_automation_job(
        'deal-broadcast',
        'notify-deal-submitted',
        jsonb_build_object('deal_id', NEW.id)
      );
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
```

If Discord is actively unusable while repairing, temporarily disable the deal Discord triggers inside the migration transaction and re-enable only after dedupe/backfill is complete:

```sql
ALTER TABLE public.deals DISABLE TRIGGER trg_deal_celebration;
ALTER TABLE public.deals DISABLE TRIGGER trg_deal_closed_discord;
ALTER TABLE public.deals DISABLE TRIGGER trg_first_deal_welcome;
ALTER TABLE public.deals DISABLE TRIGGER trg_hot_streak;
ALTER TABLE public.deals DISABLE TRIGGER trg_referral_ask;
```

Re-enable after verification only if their `WHEN (public.is_fresh_deal_close(...))` clauses are still present and inbound sync cannot synthesize freshness.

### 1. Pick One AgentLink Writer

Use either `agentlink-cookie-sync` Edge Function or `public.agentlink_live_pull()`, not both.

Preferred path based on current edits:

- Keep `supabase/functions/agentlink-cookie-sync/index.ts`.
- Keep `.github/workflows/external-cron-backup.yml` calling the Edge Function.
- Remove or do not add the `cron.schedule('agentlink-live-pull', '*/5 * * * *', SELECT public.agentlink_live_pull())` block from `20260516093000_agentlink_truth_sync_repair.sql`.
- Unschedule the old DB cron:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agentlink-live-pull') THEN
    PERFORM cron.unschedule('agentlink-live-pull');
  END IF;
END $$;
```

Lock the raw RPC down:

```sql
REVOKE ALL ON FUNCTION public.agentlink_live_pull() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agentlink_live_pull() TO service_role;
```

Make the UI call `agentlink-cookie-sync` only, with a logged-in admin session or bot token. The function may remain `verify_jwt = false` only if the in-function auth gate is solid.

### 2. Normalize And Backfill Existing Deals

Add a migration that:

- Normalizes policy numbers with a helper function.
- Creates a temporary/canonical duplicate review table before deleting anything.
- Backfills `status`, `pipeline_stage`, `source`, `posted_at`, and `status_updated_at`.
- Dedupes `(agent_id, normalized_policy_number)` safely.
- Adds a unique index after cleanup.

Use a reversible backup table:

```sql
CREATE TABLE IF NOT EXISTS public.deals_dedupe_backup_20260516 AS
SELECT *
FROM public.deals
WHERE false;
```

Backfill statuses:

```sql
UPDATE public.deals
SET
  status = COALESCE(
    status,
    public.map_al_status(policy_status_standard),
    'submitted'
  ),
  pipeline_stage = CASE COALESCE(public.map_al_status(policy_status_standard), status, 'submitted')
    WHEN 'active' THEN 'approved'
    WHEN 'lapsed' THEN 'lapsed'
    ELSE 'submitted'
  END,
  source = COALESCE(source, 'agent_link'),
  status_updated_at = COALESCE(status_updated_at, now()),
  posted_at = COALESCE(posted_at, created_at)
WHERE source = 'agent_link'
   OR status IS NULL
   OR pipeline_stage IS NULL;
```

Deduping rule:

- Partition by `(agent_id, lower(trim(policy_number)))`.
- Keep the row with the richest data:
  - non-null status first,
  - non-null external_deal_id first,
  - non-placeholder client fields first,
  - latest `posted_at` / `updated_at` next.
- Merge useful fields into the canonical row before deleting duplicates.
- Insert all deleted rows into `deals_dedupe_backup_20260516`.
- Do not delete rows with different real policy numbers.

After cleanup, add a unique guard:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_agent_policy_number_unique
ON public.deals (agent_id, lower(trim(policy_number)))
WHERE policy_number IS NOT NULL AND trim(policy_number) <> '';
```

If this index fails, stop and report the remaining duplicate groups instead of forcing it.

### 3. Fix Mapping Gaps

Backfill:

- `agents.insuracloud_user_id` from AgentLink `userId`, matching by reliable upstream IDs first, then exact normalized full name only when unambiguous.
- `carriers.insuracloud_carrier_id` from AgentLink `carrierId`, matching by exact known carrier map first.

Report, do not guess, any unresolved:

- unmatched upstream `userId` counts,
- unmatched `carrierId` counts,
- active APEX agents without `insuracloud_user_id`,
- active carriers without `insuracloud_carrier_id`.

### 4. Probe Endpoints And Vault 200 Responses

Create a local script, for example `scripts/probe-agentlink.mjs`, that:

- Uses only authorized credentials already present in Supabase settings or local secure files.
- Probes:
  - `GET https://agentlink.insuracloud.ai/api/user`
  - `GET https://agentlink.insuracloud.ai/api/deals`
  - known broken endpoint `GET /api/v1/book-of-business` for status evidence only.
- Stores every HTTP 200 response under `.vault/agentlink/<timestamp>/`.
- Redacts obvious sensitive fields before writing any human report.
- Writes SHA256 hashes, byte sizes, status codes, and top-level schema keys.
- Ensures `.vault/` is gitignored.

Do not paste raw book-of-business JSON or cookie values into chat.

### 5. Harden Notifications

For Discord:

- Ensure deal Discord triggers only fire on true live APEX-originated closes, or explicitly live AgentLink closes after dedupe is proven.
- Add an idempotency table or unique guard using `discord_event_log(event_type, entity_id, channel)`.
- No Discord post should be made without recording the event id and HTTP result.
- Remove hardcoded Discord webhook literals/fallbacks from code and migrations. Keep only server-side env or `system_settings`.
- Rotate any webhook that ever appeared in committed migrations or client-visible code.

For bot/automation logs:

- Update `run_automation_job()` so `success` means actual response success, or rename current behavior to `queued`.
- Ideally collect pg_net response and store `http_status` / response body.
- Functions invoked by `run_automation_job()` should update `automation_run_log` using `x-automation-log-id` if possible.

### 6. Harden Edge Functions

Add internal auth gates to any `verify_jwt = false` function that can mutate data or trigger upstream calls, especially:

- `supabase/functions/insuracloud-outbox/index.ts`
- `supabase/functions/agentlink-cookie-sync/index.ts` (already started, verify it fully)
- `supabase/functions/insuracloud-sync/index.ts` (already has auth, keep it)

Pattern: accept only configured bot tokens or verified admin Supabase users. Return `401`/`403` loudly.

### 7. Verify Counts

Run these aggregate checks after fixes:

```sql
SELECT source, status, count(*) AS rows, sum(annual_premium) AS alp
FROM public.deals
GROUP BY 1,2
ORDER BY 1,2;

SELECT count(*) AS duplicate_groups
FROM (
  SELECT agent_id, lower(trim(policy_number)), count(*)
  FROM public.deals
  WHERE policy_number IS NOT NULL AND trim(policy_number) <> ''
  GROUP BY 1,2
  HAVING count(*) > 1
) d;

SELECT count(*) AS null_status_agentlink
FROM public.deals
WHERE source = 'agent_link' AND status IS NULL;

SELECT tgname, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = 'public.deals'::regclass
  AND NOT tgisinternal
ORDER BY tgname;

SELECT jobname, schedule, command, active
FROM cron.job
WHERE jobname ILIKE '%agentlink%'
   OR command ILIKE '%agentlink%'
ORDER BY jobname;

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'agentlink_live_pull'
ORDER BY grantee;
```

Expected success criteria:

- `agent_link` rows no longer have `status = NULL`.
- Duplicate `(agent_id, policy_number)` groups are `0`, or every remaining group is explicitly explained in the report.
- Imported `agent_link` rows do not create `deal-insuracloud-push` jobs.
- Backfill/import rows do not post Discord.
- Only one AgentLink writer is active.
- `agentlink_live_pull()` is not callable by `PUBLIC`, `anon`, or normal `authenticated`.
- `.vault/` contains endpoint probes and hashes, but no raw data is committed.

### 8. Local Verification

Run:

```bash
npm run check:sync-reliability
npm run check:metric-truth
npx tsc --noEmit
npm run build
```

If any command fails, fix the underlying issue or document why it is unrelated.

## Deliverables

Return:

- Files changed.
- SQL migration name.
- Exact live counts before/after.
- Which sync path is now the only writer.
- Which triggers are active after repair.
- Which data remains locked/unmapped and why.
- Which secrets/webhooks must be rotated.
- Confirmation that Discord is quiet during backfill and only live events are allowed afterward.
