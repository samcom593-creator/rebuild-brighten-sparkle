-- wave-insuracloud-outbox-truth (2026-08-11)
--
-- The Apex -> InsuraCloud write path has never succeeded once. Measured today
-- before any of this was written:
--
--   deals total ................. 1,759
--   deals synced (lifetime) ..... 0
--   unsynced annual premium ..... $2,336,292.84   ($313,806.84 in trailing 30d)
--   oldest recorded failure ..... 2026-05-14      (bot_alerts back to 2026-04-22)
--
-- It is not a missing writer. trg_deals_autopush_insuracloud is ENABLED, calls
-- deals_trigger_insuracloud_push(), which fires run_automation_job(
-- 'deal-insuracloud-push', 'insuracloud-outbox'), and that edge function does
-- write synced_to_insuracloud_at on success. It runs. It fails, every time.
--
-- Root causes, measured, and why the obvious fix is the wrong one:
--
--   1,058  "No InsuraCloud API token configured (agent or default)"
--          insuracloud-outbox/index.ts:51 reads its default token from the Deno
--          env var INSURACLOUD_API_TOKEN, which is unset. The token harvested on
--          2026-05-19 lives in system_settings.insuracloud_api_token and the
--          function never looks there. 1 of 111 active agents carries a token.
--
--     505  "InsuraCloud api-key 403: Invalid CSRF token"
--          That is the one agent who does have a token. It starts with al_, so
--          isApiKey is true and the function POSTs /api/v1/book-of-business with
--          x-api-key. index.ts:100-103 states in its own comment that this
--          endpoint is read-only and that /api/deals requires a session + CSRF.
--          The al_ branch is documented-dead with an 0-for-505 lifetime record.
--
--       6  "Deal has no carrier"
--
-- So setting INSURACLOUD_API_TOKEN would move 1,058 deals out of "no token" and
-- into the same 403 branch that has never worked. It would look like progress in
-- the error histogram and change the sync count by zero. The only branch that
-- can succeed is the connect.sid session-cookie + /api/csrf-token + /api/deals
-- path, which is never taken because the stored default token is an api-key.
-- That fix needs a live handshake against InsuraCloud and is deliberately NOT in
-- this migration. This migration makes the failure impossible to misread and
-- stops it drowning the alert channel.
--
-- Re-run the measurement any time:  select * from v_insuracloud_outbox_truth;

-- ---------------------------------------------------------------------------
-- 1. The standing number, in one place, so it is never hand-derived again.
-- ---------------------------------------------------------------------------
create or replace view public.v_insuracloud_outbox_truth as
select
  count(*)                                                   as deals_total,
  count(synced_to_insuracloud_at)                            as deals_synced_lifetime,
  count(*) filter (where synced_to_insuracloud_at is null
                     and status is distinct from 'draft')    as deals_pending,
  count(*) filter (where insuracloud_sync_error is not null
                     and synced_to_insuracloud_at is null)   as deals_errored,
  round(100.0 * count(synced_to_insuracloud_at)
        / nullif(count(*), 0), 2)                            as lifetime_success_pct,
  round(coalesce(sum(annual_premium)
        filter (where synced_to_insuracloud_at is null), 0)::numeric, 2)
                                                             as unsynced_annual_premium,
  round(coalesce(sum(annual_premium) filter (
          where synced_to_insuracloud_at is null
            and created_at > now() - interval '30 days'), 0)::numeric, 2)
                                                             as unsynced_annual_premium_30d,
  max(synced_to_insuracloud_at)                              as newest_sync_at,
  max(updated_at) filter (where insuracloud_sync_error is not null)
                                                             as newest_error_at
from public.deals;

comment on view public.v_insuracloud_outbox_truth is
  'Lifetime truth for the Apex->InsuraCloud write path. deals_synced_lifetime = 0 '
  'means the integration has never once worked, regardless of how healthy the '
  'per-deal error histogram looks. apex-doctor Check #17 reads this.';

-- ---------------------------------------------------------------------------
-- 2. Root causes bucketed, so "which failure is this" is not a grep exercise.
-- ---------------------------------------------------------------------------
create or replace view public.v_insuracloud_outbox_root_causes as
select
  case
    when insuracloud_sync_error ilike 'No InsuraCloud API token configured%'
      then 'no_default_token_env'
    when insuracloud_sync_error ilike 'InsuraCloud api-key 40%'
      then 'api_key_path_is_read_only'
    when insuracloud_sync_error ilike 'Deal has no carrier%'
      then 'deal_missing_carrier'
    when insuracloud_sync_error ilike '%has no insuracloud_carrier_id%'
      then 'carrier_unmapped'
    when insuracloud_sync_error ilike 'csrf-token fetch%'
      then 'session_cookie_expired'
    else 'other'
  end                                            as root_cause,
  count(*)                                       as deals,
  round(coalesce(sum(annual_premium), 0)::numeric, 2) as annual_premium,
  min(updated_at)                                as first_seen,
  max(updated_at)                                as last_seen
from public.deals
where insuracloud_sync_error is not null
  and synced_to_insuracloud_at is null
group by 1
order by 2 desc;

comment on view public.v_insuracloud_outbox_root_causes is
  'Per-root-cause breakdown of unsynced deals. api_key_path_is_read_only is not '
  'a transient error — index.ts documents that endpoint as read-only, so that '
  'bucket can never drain without changing which auth branch the function takes.';

-- ---------------------------------------------------------------------------
-- 3. De-storm the alert channel, without making the failure invisible.
--
-- bot_alerts holds 2,779 rows. 1,680 of them (60.5%) are insuracloud_sync_error
-- — 243 in the trailing 30 days, newest today. The next-largest event type is
-- big_deal at 144. One integration that has never worked owns three fifths of
-- the only channel that is supposed to tell Sam when something breaks. That is
-- the same cost the 36 false pages/day and the 39 true-but-misleading pages/day
-- carried in the three waves before this one: a channel nobody can read.
--
-- These three error strings are diagnosed, standing, and unchanged since May.
-- They stop paging per deal. apex-doctor Check #17 states the condition once,
-- with the dollar figure, and goes green the moment a single sync succeeds.
-- Any error string OUTSIDE this set still pages immediately — a genuine new
-- failure mode is exactly what this channel is for.
--
-- Also fixes a latent P0 in the original: it had no EXCEPTION guard, so any
-- failure inserting into bot_alerts (constraint, RLS, type drift) propagated and
-- rolled back the UPDATE on deals that triggered it. The alert about a failed
-- sync could kill the row it was reporting on. Wrapped, and search_path pinned,
-- matching its sibling deals_trigger_insuracloud_push().
-- ---------------------------------------------------------------------------
create or replace function public.bot_alert_sync_error()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.insuracloud_sync_error is null
     or old.insuracloud_sync_error is not distinct from new.insuracloud_sync_error then
    return new;
  end if;

  -- Diagnosed standing root causes: owned by apex-doctor Check #17, not by a
  -- per-deal page. Keep this list in step with v_insuracloud_outbox_root_causes.
  if new.insuracloud_sync_error ilike 'No InsuraCloud API token configured%'
     or new.insuracloud_sync_error ilike 'InsuraCloud api-key 40%'
     or new.insuracloud_sync_error ilike 'Deal has no carrier%' then
    return new;
  end if;

  insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
  values (
    'trigger',
    'insuracloud_sync_error',
    'warn',
    'InsuraCloud sync error (new failure mode)',
    format('<p>Deal %s failed to sync with an error not seen before:</p><pre>%s</pre>', new.id, new.insuracloud_sync_error),
    format('APEX: IC sync new failure %s', substring(new.insuracloud_sync_error, 1, 50)),
    array['email']::text[]
  );

  return new;
exception when others then
  -- Never let the alert about a failed write roll back the write it reports on.
  return new;
end;
$function$;
