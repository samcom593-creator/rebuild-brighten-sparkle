-- Second-pass Supabase usage controls (2026-09-04).
--
-- This migration deliberately excludes the first-pass web-vitals and empty
-- outbox fixes. Production evidence since pg_stat_statements reset at
-- 2026-08-26 02:56Z:
--   * agentlink_book_rebuild: 455 calls, 6.34M WAL records / 788.5 MB WAL.
--   * agentlink_sync_snapshot_from_book: 455 calls, 4.83M records / 596.6 MB.
--     Both functions deleted and reinserted the whole 1,734-row mirror every
--     20 minutes even though zero rows were posted in the measured 48h.
--   * ReadyMode rolling-window upserts: 398,059 table updates and 596.3 MB WAL.
--   * readymode-sync: 285 failed polls/24h; last non-empty pull was Aug 31.
--   * refresh_sync_health: 13,970 writes / 8.86 MB WAL. An internal one-minute
--     cron wrote the value named last_external_cron_run, defeating the signal.
--   * the GitHub cron heartbeat scanned cron.job_run_details (532 MB): 366
--     calls, 1,881.8 seconds, 20.38M shared block reads (~163 GB).

-- v_sync_health performs several "latest row" probes. Keep the small history
-- tables indexed; the 532 MB cron ledger is handled below through its existing
-- monotonic runid primary key so release does not need a large blocking index.
create index if not exists idx_insuracloud_sync_log_created_desc
  on public.insuracloud_sync_log (created_at desc);
create index if not exists idx_insuracloud_sync_log_success_created_desc
  on public.insuracloud_sync_log (created_at desc)
  where coalesce(status, 'success') not ilike '%error%';
create index if not exists idx_insuracloud_sync_log_error_created_desc
  on public.insuracloud_sync_log (created_at desc)
  where error_message is not null;
create index if not exists idx_automation_run_log_created_desc
  on public.automation_run_log (created_at desc);

-- The prior internal cron did not refresh a materialized health object. It
-- only claimed that the EXTERNAL GitHub backup had just run. The GitHub job
-- already invokes refresh_sync_health() itself, which is the honest writer.
do $cron$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'apex-sync-health-refresh-1m'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
end
$cron$;

-- Preserve the view contract while replacing four full-ledger MAX scans with
-- backward primary-key probes. runid is allocated monotonically by pg_cron;
-- the newest row is the heartbeat, and the newest succeeded row is normally
-- found after examining one or two index entries.
create or replace view public.v_sync_health as
with ic as (
  select
    (select created_at from public.insuracloud_sync_log order by created_at desc limit 1) as last_attempt,
    (select created_at from public.insuracloud_sync_log where coalesce(status, 'success') not ilike '%error%' order by created_at desc limit 1) as last_success,
    (select status from public.insuracloud_sync_log order by created_at desc limit 1) as last_status,
    (select error_message from public.insuracloud_sync_log where error_message is not null order by created_at desc limit 1) as last_error,
    (select records_synced from public.insuracloud_sync_log order by created_at desc limit 1) as last_records
),
al as (
  select
    (select started_at from public.agentlink_sync_log order by started_at desc limit 1) as last_attempt,
    (select finished_at from public.agentlink_sync_log where status = 'ok' order by started_at desc limit 1) as last_success,
    (select status from public.agentlink_sync_log order by started_at desc limit 1) as last_status,
    (select error_message from public.agentlink_sync_log where error_message is not null order by started_at desc limit 1) as last_error
),
rm as (
  select
    (select updated_at from public.system_settings where key = 'readymode_available_leads' limit 1) as last_attempt,
    (select updated_at from public.system_settings where key = 'readymode_available_leads' limit 1) as last_success,
    (select value from public.system_settings where key = 'readymode_available_leads' limit 1) as count_value
),
pc as (
  select
    (select start_time from cron.job_run_details order by runid desc limit 1) as last_attempt,
    (select start_time from cron.job_run_details where status = 'succeeded' order by runid desc limit 1) as last_success
),
sources as (
  select 'agentlink'::text as source,
         greatest((select last_attempt from al), (select last_attempt from ic)) as last_attempt_at,
         greatest((select last_success from al), (select last_success from ic)) as last_success_at,
         'ok'::text as last_status,
         null::text as last_error,
         15::int as stale_threshold_minutes,
         case when (select last_success from al) is null then true
              when (select last_success from ic) > (select last_success from al) + interval '1 hour' then true
              else false end as is_partial,
         case when (select last_success from al) is null
                or (select last_success from ic) > (select last_success from al) + interval '6 hours'
              then 'Rotate AgentLink browser cookie at /dashboard/agentlink-sync'
              else null end as action_required
  union all
  select 'agentlink_cookie_pull',
         (select last_attempt from al),
         (select last_success from al),
         coalesce((select last_status from al), 'never_run'),
         (select last_error from al),
         60, false,
         case when (select last_success from al) is null
                or (select last_success from al) < now() - interval '6 hours'
              then 'Cookie likely expired — rotate from a logged-in AgentLink tab'
              else null end
  union all
  select 'insuracloud_api_pull',
         (select last_attempt from ic),
         (select last_success from ic),
         coalesce((select last_status from ic), 'never_run'),
         (select last_error from ic),
         15, false,
         case when (select last_success from ic) is null
                or (select last_success from ic) < now() - interval '30 minutes'
              then 'Check insuracloud-sync function logs + per-agent insuracloud_api_token rows'
              else null end
  union all
  select 'readymode_inventory',
         (select last_attempt from rm),
         (select last_success from rm),
         case when (select count_value from rm) is null then 'never_configured' else 'ok' end,
         null, 60, false,
         case when (select count_value from rm) is null
              then 'ReadyMode inventory not wired — UI shows unavailable until system_settings.readymode_available_leads is populated by a sync'
              when (select last_success from rm) < now() - interval '1 hour'
              then 'ReadyMode inventory > 1h stale — verify the upstream sync job'
              else null end
  union all
  select 'stripe_lead_purchases',
         (select charged_at from public.lead_purchases order by charged_at desc limit 1),
         (select charged_at from public.lead_purchases order by charged_at desc limit 1),
         'ok', null, 24 * 60, false, null
  union all
  select 'email_logs',
         (select created_at from public.email_delivery_log order by created_at desc limit 1),
         (select created_at from public.email_delivery_log order by created_at desc limit 1),
         'ok', null, 24 * 60, false, null
  union all
  select 'sms_logs',
         (select last_sent_at from public.sms_send_guard order by last_sent_at desc limit 1),
         (select last_sent_at from public.sms_send_guard order by last_sent_at desc limit 1),
         'ok', null, 24 * 60, false, null
  union all
  select 'automation_logs',
         (select created_at from public.automation_run_log order by created_at desc limit 1),
         (select created_at from public.automation_run_log order by created_at desc limit 1),
         'ok', null, 60, false, null
  union all
  select 'notifications',
         (select created_at from public.notification_log order by created_at desc limit 1),
         (select created_at from public.notification_log order by created_at desc limit 1),
         'ok', null, 60, false, null
  union all
  select 'seminar_reminders',
         (select created_at from public.idempotency_keys where idempotency_key like 'seminar_reminder:%' order by created_at desc limit 1),
         (select created_at from public.idempotency_keys where idempotency_key like 'seminar_reminder:%' order by created_at desc limit 1),
         'ok', null, 24 * 60, false, null
  union all
  select 'github_external_cron',
         (select value::timestamptz from public.system_settings where key = 'last_external_cron_run' limit 1),
         (select value::timestamptz from public.system_settings where key = 'last_external_cron_run' limit 1),
         'ok', null, 20, false, null
  union all
  select 'supabase_pg_cron',
         (select last_attempt from pc),
         (select last_success from pc),
         case when (select last_attempt from pc) is null then 'never_run' else 'ok' end,
         null, 20, false,
         case when (select last_attempt from pc) is null
              then 'pg_cron bgworker is asleep — toggle pg_cron extension off→on in Supabase Dashboard → Database → Extensions'
              else null end
)
select source, last_attempt_at, last_success_at, last_status, last_error,
       stale_threshold_minutes, is_partial, action_required,
       case when last_success_at is null then null
            else extract(epoch from (now() - last_success_at))::int / 60 end as stale_minutes,
       case when last_success_at is null then true
            when extract(epoch from (now() - last_success_at))::int / 60 > stale_threshold_minutes then true
            else false end as is_stale
from sources;

grant select on public.v_sync_health to authenticated;

-- Stage the incoming full book in a transaction-local table, then mutate only
-- inserts, real changes, and removals. Exact repeats now write one small
-- freshness row instead of delete+insert fan-out across two mirrors.
create or replace function public.agentlink_book_rebuild(p_deals jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n integer;
begin
  if jsonb_typeof(p_deals) <> 'array' or jsonb_array_length(p_deals) = 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtext('agentlink_book_rebuild'));
  create temporary table if not exists agentlink_book_stage
    (like public.agentlink_book including defaults)
    on commit drop;
  truncate pg_temp.agentlink_book_stage;

  insert into pg_temp.agentlink_book_stage
    (deal_key, agent_name, agent_id, client_name, carrier, product,
     policy_number, status, is_dead, monthly_premium, annual_premium,
     effective_date, posted_date, source, imported_at, user_id, carrier_id,
     pipeline_client_id, face_amount, client_first_name, client_last_name,
     policy_expiration_date)
  select s.deal_key, coalesce(am.nm, s.feed_name, 'Unknown'), am.agent_id,
         trim(coalesce(s.cf, '') || ' ' || coalesce(s.cl, '')),
         s.carrier, s.product, s.policy_number, s.st,
         s.st in ('Declined','Lapsed','Withdrawn','Cancelled','Not Taken','Lapse Pending'),
         s.mp, s.ap, s.eff, s.posted, 'agentlink_deals_live', now(),
         s.uid, s.cid, s.pcid, s.fa, s.cf, s.cl, s.expd
  from (
    select distinct on (deal_key) *
    from (
      select md5(coalesce(nullif(d->>'id',''), (d->>'policyNumber') || '|' || (d->>'userId'))) as deal_key,
             nullif(d->>'userId','')::int as uid,
             nullif(d->>'carrierId','')::int as cid,
             coalesce(d->'policyStatus'->>'standardStatus','Unknown') as st,
             nullif(d->>'agentName','') as feed_name,
             coalesce(nullif(regexp_replace(coalesce(d->>'annualPremium',''),'[^0-9.\-]','','g'),'')::numeric,0) as ap,
             coalesce(nullif(regexp_replace(coalesce(d->>'monthlyPremium',''),'[^0-9.\-]','','g'),'')::numeric,0) as mp,
             coalesce(nullif(regexp_replace(coalesce(d->>'faceAmount',''),'[^0-9.\-]','','g'),'')::numeric,0) as fa,
             case when nullif(d->>'createdAt','') ~ '^\d{4}-\d{2}-\d{2}' then (d->>'createdAt')::date else current_date end as posted,
             case when nullif(d->>'effectiveDate','') ~ '^\d{4}-\d{2}-\d{2}' then (d->>'effectiveDate')::date else null end as eff,
             case when nullif(d->>'policyExpirationDate','') ~ '^\d{4}-\d{2}-\d{2}' then (d->>'policyExpirationDate')::date else null end as expd,
             nullif(d->>'clientFirstName','') as cf,
             nullif(d->>'clientLastName','') as cl,
             coalesce(d->'carrier'->>'name', nullif(d->>'carrierName','')) as carrier,
             coalesce(nullif(d->>'productSold',''),'Life Insurance') as product,
             nullif(d->>'policyNumber','') as policy_number,
             nullif(d->>'pipelineClientId','')::int as pcid
      from jsonb_array_elements(p_deals) d
    ) parsed
    order by deal_key, posted desc
  ) s
  left join lateral (
    select a.id as agent_id, coalesce(p.full_name, a.display_name) as nm
    from public.agents a
    left join public.profiles p on p.id = a.user_id
    where a.al_user_id = s.uid or a.insuracloud_user_id = s.uid
       or lower(trim(a.display_name)) = lower(trim(s.feed_name))
    order by (a.canonical_agent_id is null) desc,
             (a.al_user_id = s.uid) desc, a.created_at
    limit 1
  ) am on true;

  insert into public.agentlink_book as b
    (deal_key, agent_name, agent_id, client_name, carrier, product,
     policy_number, status, is_dead, monthly_premium, annual_premium,
     effective_date, posted_date, source, imported_at, user_id, carrier_id,
     pipeline_client_id, face_amount, client_first_name, client_last_name,
     policy_expiration_date)
  select deal_key, agent_name, agent_id, client_name, carrier, product,
         policy_number, status, is_dead, monthly_premium, annual_premium,
         effective_date, posted_date, source, imported_at, user_id, carrier_id,
         pipeline_client_id, face_amount, client_first_name, client_last_name,
         policy_expiration_date
  from pg_temp.agentlink_book_stage
  on conflict (deal_key) do update set
    agent_name = excluded.agent_name,
    agent_id = excluded.agent_id,
    client_name = excluded.client_name,
    carrier = excluded.carrier,
    product = excluded.product,
    policy_number = excluded.policy_number,
    status = excluded.status,
    is_dead = excluded.is_dead,
    monthly_premium = excluded.monthly_premium,
    annual_premium = excluded.annual_premium,
    effective_date = excluded.effective_date,
    posted_date = excluded.posted_date,
    source = excluded.source,
    imported_at = excluded.imported_at,
    user_id = excluded.user_id,
    carrier_id = excluded.carrier_id,
    pipeline_client_id = excluded.pipeline_client_id,
    face_amount = excluded.face_amount,
    client_first_name = excluded.client_first_name,
    client_last_name = excluded.client_last_name,
    policy_expiration_date = excluded.policy_expiration_date
  where (to_jsonb(b) - 'imported_at') is distinct from
        (to_jsonb(excluded) - 'imported_at');

  delete from public.agentlink_book b
  where not exists (
    select 1 from pg_temp.agentlink_book_stage s where s.deal_key = b.deal_key
  );

  select count(*)::integer into v_n from pg_temp.agentlink_book_stage;
  insert into public.system_settings(key, value, updated_at)
  values ('agentlink_book_last_refreshed_at', now()::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return v_n;
end
$function$;

revoke all on function public.agentlink_book_rebuild(jsonb) from public, anon, authenticated;
grant execute on function public.agentlink_book_rebuild(jsonb) to service_role;

create or replace function public.agentlink_sync_snapshot_from_book()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('agentlink_sync_snapshot_from_book'));

  insert into public.agentlink_deals_snapshot as s
    (id, user_id, carrier_id, pipeline_client_id, client_first_name,
     client_last_name, client_phone, client_dob, product_sold, policy_number,
     monthly_premium, annual_premium, face_amount, effective_date,
     policy_expiration_date, raw_status, payload, snapshot_at)
  select ('x' || substr(md5(b.deal_key),1,15))::bit(60)::bigint,
         b.user_id, b.carrier_id, b.pipeline_client_id, b.client_first_name,
         b.client_last_name, null, null, b.product, b.policy_number,
         b.monthly_premium, b.annual_premium, b.face_amount, b.effective_date,
         b.policy_expiration_date, b.status,
         jsonb_build_object('agent_name',b.agent_name,'carrier',b.carrier,
                            'is_dead',b.is_dead,'posted_date',b.posted_date),
         now()
  from public.agentlink_book b
  on conflict (id) do update set
    user_id = excluded.user_id,
    carrier_id = excluded.carrier_id,
    pipeline_client_id = excluded.pipeline_client_id,
    client_first_name = excluded.client_first_name,
    client_last_name = excluded.client_last_name,
    client_phone = excluded.client_phone,
    client_dob = excluded.client_dob,
    product_sold = excluded.product_sold,
    policy_number = excluded.policy_number,
    monthly_premium = excluded.monthly_premium,
    annual_premium = excluded.annual_premium,
    face_amount = excluded.face_amount,
    effective_date = excluded.effective_date,
    policy_expiration_date = excluded.policy_expiration_date,
    raw_status = excluded.raw_status,
    payload = excluded.payload,
    snapshot_at = excluded.snapshot_at
  where (to_jsonb(s) - 'snapshot_at') is distinct from
        (to_jsonb(excluded) - 'snapshot_at');

  delete from public.agentlink_deals_snapshot s
  where not exists (
    select 1
    from public.agentlink_book b
    where ('x' || substr(md5(b.deal_key),1,15))::bit(60)::bigint = s.id
  );

  select count(*)::integer into v_n from public.agentlink_deals_snapshot;
  return v_n;
end
$function$;

revoke all on function public.agentlink_sync_snapshot_from_book() from public, anon, authenticated;
grant execute on function public.agentlink_sync_snapshot_from_book() to service_role;

-- Unchanged book rows correctly keep their row-level imported_at. This single
-- state value records a successful complete pull without touching all rows.
create or replace function public.production_book_freshness()
returns table (
  last_posted_date date,
  last_posted_count integer,
  last_posted_ap numeric,
  last_synced_at timestamptz,
  live_policies integer
)
language sql
stable
security definer
set search_path = public
as $function$
  with scoped as (
    select t.posted_date, t.annual_premium, t.synced_at
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and (public.apex_is_admin() or public.crm_can_read_agent_scope(t.agent_id))
  ), newest as (
    select max(posted_date) as d from scoped
  )
  select
    (select d from newest),
    (select count(*)::integer from scoped s, newest n where s.posted_date = n.d),
    (select coalesce(sum(annual_premium), 0) from scoped s, newest n where s.posted_date = n.d),
    greatest(
      (select nullif(value, '')::timestamptz from public.system_settings where key = 'agentlink_book_last_refreshed_at'),
      (select max(imported_at) from public.agentlink_book),
      (select max(synced_at) from scoped)
    ),
    (select count(*)::integer from scoped);
$function$;

revoke all on function public.production_book_freshness() from public, anon;
grant execute on function public.production_book_freshness() to authenticated, service_role;

-- ReadyMode returns a rolling window, so repeated source rows are expected.
-- Keep late disposition/recording changes while suppressing exact repeats.
create or replace function public.upsert_readymode_dialer_calls(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_changed integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  with incoming as (
    select *
    from jsonb_to_recordset(p_rows) as x(
      external_call_id text,
      agent_raw text,
      campaign_name text,
      lead_phone text,
      lead_first_name text,
      lead_last_name text,
      lead_email text,
      disposition text,
      disposition_at timestamptz,
      call_started_at timestamptz,
      call_ended_at timestamptz,
      duration_seconds integer,
      recording_url text,
      notes text,
      raw jsonb
    )
  ), changed as (
    insert into public.readymode_dialer_calls as d
      (external_call_id, agent_raw, campaign_name, lead_phone,
       lead_first_name, lead_last_name, lead_email, disposition,
       disposition_at, call_started_at, call_ended_at, duration_seconds,
       recording_url, notes, raw)
    select external_call_id, agent_raw, campaign_name, lead_phone,
           lead_first_name, lead_last_name, lead_email, disposition,
           disposition_at, call_started_at, call_ended_at, duration_seconds,
           recording_url, notes, raw
    from incoming
    where nullif(external_call_id, '') is not null
    on conflict (external_call_id) do update set
      agent_raw = excluded.agent_raw,
      campaign_name = excluded.campaign_name,
      lead_phone = excluded.lead_phone,
      lead_first_name = excluded.lead_first_name,
      lead_last_name = excluded.lead_last_name,
      lead_email = excluded.lead_email,
      disposition = excluded.disposition,
      disposition_at = excluded.disposition_at,
      call_started_at = excluded.call_started_at,
      call_ended_at = excluded.call_ended_at,
      duration_seconds = excluded.duration_seconds,
      recording_url = excluded.recording_url,
      notes = excluded.notes,
      raw = excluded.raw,
      updated_at = now()
    where (d.agent_raw, d.campaign_name, d.lead_phone,
           d.lead_first_name, d.lead_last_name, d.lead_email,
           d.disposition, d.disposition_at, d.call_started_at,
           d.call_ended_at, d.duration_seconds, d.recording_url,
           d.notes, d.raw)
      is distinct from
          (excluded.agent_raw, excluded.campaign_name, excluded.lead_phone,
           excluded.lead_first_name, excluded.lead_last_name,
           excluded.lead_email, excluded.disposition,
           excluded.disposition_at, excluded.call_started_at,
           excluded.call_ended_at, excluded.duration_seconds,
           excluded.recording_url, excluded.notes, excluded.raw)
    returning 1
  )
  select count(*)::integer into v_changed from changed;
  return v_changed;
end
$function$;

revoke all on function public.upsert_readymode_dialer_calls(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_readymode_dialer_calls(jsonb) to service_role;

-- Healthy ingestion keeps the five-minute cadence. After two dark hours, use
-- one recovery probe per hour; the first non-empty pull automatically restores
-- five-minute polling on the next cron tick.
create or replace function public.run_readymode_sync_if_due()
returns bigint
language plpgsql
security definer
set search_path = public, net, extensions
as $function$
declare
  v_last_nonempty timestamptz;
  v_last_direct_attempt timestamptz;
  v_request_id bigint;
begin
  select
    max(started_at) filter (where status = 'ok' and coalesce(pulled_count, 0) > 0),
    max(started_at) filter (
      where error_message is null
         or error_message not like 'ReadyMode ingest dark;%'
    )
  into v_last_nonempty, v_last_direct_attempt
  from public.readymode_sync_log;

  if (v_last_nonempty is null or v_last_nonempty < now() - interval '2 hours')
     and v_last_direct_attempt is not null
     and v_last_direct_attempt > now() - interval '55 minutes' then
    return null;
  end if;

  v_request_id := net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/readymode-sync',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', 'pg_cron', 'max_pages', 12),
    timeout_milliseconds := 20000
  );
  return v_request_id;
end
$function$;

revoke all on function public.run_readymode_sync_if_due() from public, anon, authenticated;
grant execute on function public.run_readymode_sync_if_due() to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'readymode-sync-pull'
  order by jobid desc
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'readymode-sync-pull',
      '*/5 * * * *',
      $job$select public.run_readymode_sync_if_due();$job$
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '*/5 * * * *',
      command := 'select public.run_readymode_sync_if_due();'
    );
  end if;
end
$cron$;

comment on function public.upsert_readymode_dialer_calls(jsonb) is
  'Change-only ReadyMode rolling-window upsert; returns actual inserts/updates.';
comment on function public.run_readymode_sync_if_due() is
  'Five-minute ReadyMode poll while healthy, hourly recovery probe after two dark hours.';

notify pgrst, 'reload schema';
