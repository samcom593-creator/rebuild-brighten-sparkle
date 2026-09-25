begin;

-- MP-BOOK-AUDIT-1 (2026-09-24). Sam: "build a bot to audit book of business ... flag policies from Foresters
-- or without policy numbers ... tally at the top and categorize ... so I can start to eliminate that and have
-- those deals transferred over carriers."
--
-- One registry decides which carriers Apex uses: carrier_registry.relationship ('active' | 'dormant' |
-- 'inactive'). Foresters was still 'active' there while Sam says it is not a carrier he uses; Royal Neighbors
-- and American Amicable were already inactive (Sam, 2026-07-27), SBLI dormant (no policy in 226 days).
-- supported_carriers (the older May flag table) disagreed on American Amicable; aligned.
--
-- Items = every LIVE policy in the AgentLink book plus the Ethos book. Two flags, four categories.
-- The daily run snapshots the tally, counts NEW flagged policies since the last run, and raises a bot_alert
-- only when something new landed (or on Mondays) — a frozen backlog paged daily is a page nobody reads.

update public.carrier_registry
   set relationship = 'inactive', stopped_on = coalesce(stopped_on, now()),
       reroute_target = coalesce(reroute_target, 'American Home Life'),
       note = concat_ws(' · ', nullif(note, ''), 'Sam 2026-09-24: we do not use Foresters — flag every policy, transfer to a carrier we use'),
       updated_at = now()
 where carrier = 'Foresters';

update public.carrier_registry
   set reroute_target = coalesce(reroute_target, 'American Home Life'), updated_at = now()
 where relationship in ('inactive','dormant') and reroute_target is null;

insert into public.supported_carriers (carrier_name, short_code, is_supported, notes)
select 'Foresters', 'FOR', false, 'Sam 2026-09-24: not a carrier we use'
where not exists (select 1 from public.supported_carriers where carrier_name = 'Foresters');
update public.supported_carriers set is_supported = false, notes = concat_ws(' · ', nullif(notes,''), 'Sam 2026-07-27: no longer working with them'), updated_at = now()
 where carrier_name = 'American Amicable' and is_supported is true;

create or replace view public.v_book_audit_items
with (security_invoker = true) as
with items as (
  select 'agentlink'::text as source, b.deal_key as item_key, b.agent_name, b.agent_id, b.client_name, b.carrier, b.product,
         b.policy_number, b.status, coalesce(b.is_dead, false) as is_dead, b.annual_premium, coalesce(b.posted_date, b.effective_date) as dated
  from public.agentlink_book b
  union all
  select 'ethos', 'ethos:' || e.id::text, coalesce(nullif(array_to_string(e.source_agent_names, ', '), ''), a.display_name), e.owner_agent_id,
         btrim(concat_ws(' ', e.client_first_name, e.client_last_name)), coalesce(nullif(e.carrier_name, ''), 'Ethos'), e.product_sold,
         e.policy_number, e.raw_status, lower(coalesce(e.raw_status, '')) in ('lapsed','cancelled','declined','withdrawn','not taken','terminated'),
         e.annual_premium, e.effective_date
  from public.ethos_book_policies e left join public.agents a on a.id = e.owner_agent_id
),
flagged as (
  select i.*,
         (coalesce(i.policy_number, '') = '' or i.policy_number ~* '^(n/?a|none|pending|tbd|-+|0+|x+)$') as flag_no_policy_number,
         coalesce(r.relationship, 'unknown') as carrier_relationship,
         (r.relationship in ('inactive','dormant')) as flag_unused_carrier,
         r.reroute_target as registry_reroute
  from items i left join public.carrier_registry r on r.carrier = i.carrier
  where not i.is_dead
)
select f.source, f.item_key, f.agent_name, f.agent_id, f.client_name, f.carrier, f.product, f.policy_number, f.status,
       f.annual_premium, f.dated, (current_date - f.dated) as age_days,
       f.flag_no_policy_number, f.flag_unused_carrier, f.carrier_relationship,
       case when f.flag_no_policy_number and f.flag_unused_carrier then 'both'
            when f.flag_no_policy_number then 'no_policy_number'
            when f.flag_unused_carrier then 'unused_carrier'
            else 'ok' end as category,
       coalesce(f.registry_reroute, (select p.suggested_carrier from public.v_carrier_reroute_plan p where p.agent_name = f.agent_name limit 1)) as reroute_to
from flagged f;

create or replace view public.v_book_audit_tally
with (security_invoker = true) as
select category, carrier, count(*) as policies, round(sum(coalesce(annual_premium, 0)), 2) as alp,
       count(distinct agent_name) as agents,
       count(*) filter (where age_days <= 30) as last_30d
from public.v_book_audit_items
where category <> 'ok'
group by category, carrier
order by category, policies desc;

create or replace view public.v_book_audit_totals
with (security_invoker = true) as
select
  (select count(*) from public.v_book_audit_items) as live_policies,
  (select round(sum(coalesce(annual_premium,0)),2) from public.v_book_audit_items) as live_alp,
  (select count(*) from public.v_book_audit_items where flag_no_policy_number) as no_policy_number_n,
  (select round(sum(coalesce(annual_premium,0)),2) from public.v_book_audit_items where flag_no_policy_number) as no_policy_number_alp,
  (select count(*) from public.v_book_audit_items where flag_unused_carrier) as unused_carrier_n,
  (select round(sum(coalesce(annual_premium,0)),2) from public.v_book_audit_items where flag_unused_carrier) as unused_carrier_alp,
  (select count(*) from public.v_book_audit_items where category = 'both') as both_n,
  (select count(*) from public.v_book_audit_items where category <> 'ok') as flagged_n,
  (select jsonb_object_agg(carrier, policies) from (select carrier, count(*) policies from public.v_book_audit_items where flag_unused_carrier group by carrier) c) as unused_by_carrier,
  (select string_agg(carrier, ', ' order by carrier) from public.carrier_registry where relationship in ('inactive','dormant')) as unused_carriers,
  (select max(imported_at) from public.agentlink_book) as agentlink_book_as_of,
  (select max(imported_at) from public.ethos_book_policies) as ethos_book_as_of;

create or replace view public.v_book_audit_by_agent
with (security_invoker = true) as
select agent_name, agent_id,
       count(*) filter (where flag_no_policy_number) as no_policy_number_n,
       round(sum(coalesce(annual_premium,0)) filter (where flag_no_policy_number), 2) as no_policy_number_alp,
       count(*) filter (where flag_unused_carrier) as unused_carrier_n,
       round(sum(coalesce(annual_premium,0)) filter (where flag_unused_carrier), 2) as unused_carrier_alp,
       (select string_agg(c || ' (' || n || ')', ', ' order by n desc) from (select carrier c, count(*) n from public.v_book_audit_items i2 where i2.agent_name = i.agent_name and i2.flag_unused_carrier group by carrier) u) as unused_carriers,
       max(reroute_to) as reroute_to,
       count(*) as live_policies
from public.v_book_audit_items i
where category <> 'ok'
group by agent_name, agent_id
order by (count(*) filter (where flag_no_policy_number)) + (count(*) filter (where flag_unused_carrier)) desc;

grant select on public.v_book_audit_items, public.v_book_audit_tally, public.v_book_audit_totals, public.v_book_audit_by_agent to authenticated;

create table if not exists public.book_audit_runs (
  id            bigserial primary key,
  ran_at        timestamptz not null default now(),
  totals        jsonb not null,
  tally         jsonb not null,
  flagged_keys  jsonb not null default '[]'::jsonb,
  new_flagged   int not null default 0,
  cleared       int not null default 0,
  alerted       boolean not null default false
);
alter table public.book_audit_runs enable row level security;
drop policy if exists book_audit_runs_admin_read on public.book_audit_runs;
create policy book_audit_runs_admin_read on public.book_audit_runs for select using (has_role(auth.uid(), 'admin'::app_role));
grant select on public.book_audit_runs to authenticated;

create or replace function public.fn_book_audit_run()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_totals jsonb; v_tally jsonb; v_keys jsonb; v_prev jsonb;
  v_new int := 0; v_cleared int := 0; v_alert boolean := false;
  v_new_list text; v_subject text; v_body text; v_sms text;
begin
  select to_jsonb(t) into v_totals from public.v_book_audit_totals t;
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_tally from public.v_book_audit_tally t;
  select coalesce(jsonb_agg(item_key), '[]'::jsonb) into v_keys from public.v_book_audit_items where category <> 'ok';
  select flagged_keys into v_prev from public.book_audit_runs order by ran_at desc limit 1;

  if v_prev is not null then
    select count(*) into v_new from jsonb_array_elements_text(v_keys) k where not (v_prev ? k);
    select count(*) into v_cleared from jsonb_array_elements_text(v_prev) k where not (v_keys ? k);
    select string_agg(i.agent_name || ' · ' || i.carrier || ' · ' || i.category || coalesce(' · $' || round(i.annual_premium)::text, ''), E'\n')
      into v_new_list
    from public.v_book_audit_items i
    where i.category <> 'ok' and not (v_prev ? i.item_key);
  end if;

  -- Page only on movement (or the Monday digest); a frozen backlog is context on the dashboard, not a page.
  v_alert := (v_prev is null) or v_new > 0 or extract(dow from (now() at time zone 'America/Phoenix')) = 1;

  insert into public.book_audit_runs (totals, tally, flagged_keys, new_flagged, cleared, alerted)
  values (v_totals, v_tally, v_keys, v_new, v_cleared, v_alert);

  if v_alert then
    v_subject := format('Book audit: %s policies flagged (%s no policy #, %s on carriers we don''t use)%s',
                        v_totals->>'flagged_n', v_totals->>'no_policy_number_n', v_totals->>'unused_carrier_n',
                        case when v_new > 0 then format(' · %s NEW', v_new) else '' end);
    v_body := format('<p><b>%s</b> live policies flagged of %s.</p><p>No policy number: <b>%s</b> ($%s ALP)<br/>Unused carriers (%s): <b>%s</b> ($%s ALP)<br/>New since last run: <b>%s</b> · cleared: %s</p>%s<p><a href="https://apex-financial.org/dashboard/book-of-business">Open the Book Audit</a> — tallies at the top, every flagged policy below with the carrier to transfer it to.</p>',
                     v_totals->>'flagged_n', v_totals->>'live_policies', v_totals->>'no_policy_number_n', v_totals->>'no_policy_number_alp',
                     v_totals->>'unused_carriers', v_totals->>'unused_carrier_n', v_totals->>'unused_carrier_alp', v_new, v_cleared,
                     case when v_new_list is not null then '<pre>' || left(v_new_list, 1500) || '</pre>' else '' end);
    v_sms := format('APEX book audit: %s flagged (%s no policy#, %s unused carrier)%s. apex-financial.org/dashboard/book-of-business',
                    v_totals->>'flagged_n', v_totals->>'no_policy_number_n', v_totals->>'unused_carrier_n',
                    case when v_new > 0 then ' +' || v_new || ' new' else '' end);
    insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
    values ('book_audit', 'book_audit_daily', case when v_new > 0 then 'warn' else 'info' end, v_subject, v_body, v_sms,
            'https://apex-financial.org/dashboard/book-of-business', array['ntfy','discord']::text[]);
  end if;

  return jsonb_build_object('flagged', v_totals->>'flagged_n', 'new', v_new, 'cleared', v_cleared, 'alerted', v_alert);
end $$;

revoke all on function public.fn_book_audit_run() from public;

select cron.unschedule(jobid) from cron.job where jobname = 'apex-book-audit-daily';
select cron.schedule('apex-book-audit-daily', '0 14 * * *', $$select public.fn_book_audit_run()$$);  -- 07:00 Phoenix

commit;
