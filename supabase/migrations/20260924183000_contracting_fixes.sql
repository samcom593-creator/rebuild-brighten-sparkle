begin;

-- MP-CONTRACTING-2b (2026-09-24). What the audit view found, and the fixes it licenses.
--   * 54 licensed agents had NO nipr_number in the DB while AgentLink (and for most, the Ethos sheet) carry
--     it — the intake form never wrote it back. Backfilled from AgentLink with a per-row audit log.
--   * 3 rows held placeholders ("00000", "397298017", "3184013187") — not NPNs; cleared, kept in the log.
--   * Jayden Jones: DB 29307906 vs AgentLink+Ethos 22307906 (typo). Chudi Ifediora: DB 23192846 (an 08-31 form
--     entry) vs the 21755124 his live carrier contracts and Ethos portal are on. Two live sources beat one form.
--   * Sam's own NPN (21346366, Ethos Instructions tab) was blank on both of his agent rows.
--   * The audit's Ethos "expected level" was reading agent_contract_levels rows seeded from AgentLink carrier
--     maxima (~70 → Level 14), which is a different vocabulary. Sam's rule (2026-09-16): everyone is 60% = Level
--     12 unless HE set it; the human-set rows carry source 'sam_directive_*' / 'admin_ui'. Re-based on those.
--   * Doctor Check (2026-09-20): Marlyn Johnson (active, hired 09-10) has no agent.hired outbox event — the
--     same two rows fn_notify_agent_hired would have written are inserted here (idempotent keys).

create table if not exists public.npn_audit_log (
  id         bigserial primary key,
  agent_id   uuid not null,
  old_npn    text,
  new_npn    text,
  source     text not null,
  note       text,
  changed_at timestamptz not null default now()
);
alter table public.npn_audit_log enable row level security;
drop policy if exists npn_audit_log_admin_read on public.npn_audit_log;
create policy npn_audit_log_admin_read on public.npn_audit_log for select using (has_role(auth.uid(), 'admin'::app_role));

-- 1) Named corrections (pre-image kept in the log).
with fixes(id8, name, old_npn, new_npn, source, note) as (values
  ('29cf07b9', 'Jayden Jones',   '29307906', '22307906', 'agentlink+ethos_agree', 'DB 29307906 was a typo; AgentLink and the Ethos sheet both carry 22307906'),
  ('a60e70c5', 'Chudi Ifediora', '23192846', '21755124', 'agentlink+ethos_agree', 'DB 23192846 came from an 08-31 form entry; live AgentLink contracts and the Ethos portal are on 21755124'),
  ('7c3c5581', 'Samuel James',   null,       '21346366', 'ethos_instructions_tab', 'Sam''s own NPN — Point of Contact NPN on the Ethos sheet'),
  ('cde14d07', 'Samuel James',   null,       '21346366', 'ethos_instructions_tab', 'Sam''s second agent row')
)
insert into public.npn_audit_log (agent_id, old_npn, new_npn, source, note)
select a.id, a.nipr_number, f.new_npn, f.source, f.note
from fixes f join public.agents a on left(a.id::text, 8) = f.id8 and a.display_name = f.name and a.nipr_number is not distinct from f.old_npn
where a.nipr_number is distinct from f.new_npn;

update public.agents a set nipr_number = l.new_npn
from public.npn_audit_log l
where l.agent_id = a.id and l.source in ('agentlink+ethos_agree','ethos_instructions_tab') and l.changed_at > now() - interval '2 minutes';

-- 2) Placeholders are not NPNs.
insert into public.npn_audit_log (agent_id, old_npn, new_npn, source, note)
select id, nipr_number, null, 'placeholder_cleared', 'value fails fn_npn_plausible (repeated digits / outside the issued NPN range); a real NPN must be collected'
from public.agents where nipr_number is not null and not public.fn_npn_plausible(nipr_number, null);
update public.agents set nipr_number = null where nipr_number is not null and not public.fn_npn_plausible(nipr_number, null);

-- 3) Backfill from AgentLink (and the Ethos sheet) where the DB is blank. Refuse when another live agent row
--    already carries that NPN: that is a duplicate PERSON (KJ Vaughn / Kaeden Vaughns, Mateo Askew x2) and a
--    merge is Sam's click, not a backfill.
insert into public.npn_audit_log (agent_id, old_npn, new_npn, source, note)
select v.agent_id, v.npn_db, coalesce(v.npn_al, v.npn_ethos),
       case when v.npn_verdict = 'db_blank_agentlink_has' then 'agentlink_roster' else 'ethos_roster' end,
       case when v.npn_al is not null and v.npn_ethos = v.npn_al then 'AgentLink and the Ethos sheet agree'
            when v.npn_al is not null then 'AgentLink only' else 'Ethos sheet only' end
from public.v_contracting_audit v
where v.npn_db is null and v.npn_verdict in ('db_blank_agentlink_has','db_blank_ethos_has')
  and not exists (select 1 from public.agents o where o.id <> v.agent_id and o.nipr_number = coalesce(v.npn_al, v.npn_ethos)
                    and o.is_deactivated is not true and o.status::text <> 'terminated');
update public.agents a set nipr_number = l.new_npn
from public.npn_audit_log l
where l.agent_id = a.id and l.source in ('agentlink_roster','ethos_roster') and a.nipr_number is null and l.changed_at > now() - interval '2 minutes';

-- 4) Re-base the audit's comp source and add the two verdicts the first cut lacked.
drop view if exists public.v_ethos_agent_updates;
drop view if exists public.v_ethos_paste_rows;
drop view if exists public.v_contracting_audit_summary;
drop view if exists public.v_contracting_audit;

create view public.v_contracting_audit
with (security_invoker = true) as
with a as (
  select ag.id, ag.display_name, lower(p.email) as email, p.phone, ag.nipr_number as npn_db, ag.nipr_verified,
         ag.license_status, ag.status::text as status, ag.is_inactive, ag.canonical_agent_id, ag.al_user_id,
         ag.contracted_at, ag.eo_certificate_url is not null as has_eo, ag.eft_ready,
         -- Sam's rule: 60% (= Level 12) unless a human set it. AgentLink-seeded rows are carrier maxima, a different vocabulary.
         coalesce((select l.contract_pct from public.agent_contract_levels l where l.agent_id = ag.id
                     and (l.source ilike 'sam_directive%' or l.source = 'admin_ui') limit 1), 60)::numeric as comp_pct,
         m.display_name as manager_name, r.recon_bucket
  from public.agents ag
  left join public.profiles p on p.id = ag.profile_id
  left join public.agents m on m.id = ag.manager_id
  left join public.v_contracting_reconciliation r on r.agent_id = ag.id
  where ag.is_deactivated is not true and ag.status::text <> 'terminated' and ag.canonical_agent_id is null
),
al as (
  select a.id as agent_id, r.*
  from a
  join lateral (
    select * from public.agentlink_roster r
    where r.al_user_id = a.al_user_id
       or (a.al_user_id is null and a.email is not null and lower(r.email) = a.email)
       or (a.al_user_id is null and lower(btrim(r.first_name) || ' ' || btrim(r.last_name)) = lower(regexp_replace(a.display_name, '\s+', ' ', 'g')))
    order by (r.al_user_id = a.al_user_id) desc nulls last, r.active_contracts desc nulls last
    limit 1
  ) r on true
),
et as (
  select a.id as agent_id, e.*
  from a
  join lateral (
    select * from public.ethos_roster e
    where (a.npn_db is not null and e.npn = a.npn_db)
       or (a.email is not null and lower(e.email) = a.email)
       or lower(btrim(e.first_name) || ' ' || btrim(e.last_name)) = lower(regexp_replace(a.display_name, '\s+', ' ', 'g'))
    order by (e.npn = a.npn_db) desc nulls last, (lower(e.email) = a.email) desc nulls last, e.id desc
    limit 1
  ) e on true
),
x as (
  select a.*, al.al_user_id as al_id, al.npn as npn_al, al.approval_status as al_approval, al.total_contracts as al_total, al.active_contracts as al_active,
         al.carriers as al_carriers, al.synced_at as al_synced_at,
         et.npn as npn_ethos, et.comp_level as ethos_level, et.portal as ethos_portal, et.partner_id as ethos_partner_id, et.subagency as ethos_subagency,
         et.synced_at as ethos_synced_at,
         public.fn_npn_plausible(a.npn_db, a.phone) as npn_db_ok,
         public.fn_npn_plausible(al.npn, a.phone) as npn_al_ok,
         public.fn_npn_plausible(et.npn, a.phone) as npn_ethos_ok,
         (select string_agg(o.display_name, ' | ') from public.agents o
            where o.id <> a.id and o.is_deactivated is not true and o.status::text <> 'terminated'
              and o.nipr_number is not null and o.nipr_number = coalesce(a.npn_db, al.npn)) as dup_npn_with
  from a left join al on al.agent_id = a.id left join et on et.agent_id = a.id
),
y as (
  select x.*,
    case
      when x.npn_db is null and coalesce(x.npn_al_ok, false) then 'db_blank_agentlink_has'
      when x.npn_db is null and coalesce(x.npn_ethos_ok, false) then 'db_blank_ethos_has'
      when x.npn_db is null then 'missing'
      when not x.npn_db_ok then 'invalid'
      when (x.npn_al is not null and x.npn_al_ok and x.npn_al <> x.npn_db)
        or (x.npn_ethos is not null and x.npn_ethos_ok and x.npn_ethos <> x.npn_db) then 'mismatch'
      when x.nipr_verified or (x.npn_al = x.npn_db) or (x.npn_ethos = x.npn_db) then 'valid'
      else 'valid_unconfirmed'
    end as npn_verdict,
    case
      when x.npn_db = '21346366' then 'subagency_head'
      when x.npn_ethos is null and x.ethos_level is null then 'not_on_sheet'
      when x.ethos_partner_id is not null then 'portal_created'
      when x.ethos_portal ilike '%reparent%' then 'needs_reparenting'
      else 'on_sheet_pending'
    end as ethos_status,
    public.fn_ethos_level_for_pct(x.comp_pct) as ethos_level_expected,
    case
      when x.npn_db = '21346366' then 'ok'
      when x.npn_ethos is null and x.ethos_level is null then null
      when x.ethos_level is null or x.ethos_level !~* '^level' then 'raw_or_blank'
      when regexp_replace(x.ethos_level, '\D', '', 'g')::int < regexp_replace(public.fn_ethos_level_for_pct(x.comp_pct), '\D', '', 'g')::int then 'below_expected'
      else 'ok'
    end as ethos_level_verdict,
    (select string_agg(c->>'name', ', ' order by c->>'name') from jsonb_array_elements(coalesce(x.al_carriers,'[]'::jsonb)) c where c->>'status' = 'active') as al_carriers_active,
    (select string_agg(c->>'name' || ' [' || (c->>'status') || ']', ', ' order by c->>'name') from jsonb_array_elements(coalesce(x.al_carriers,'[]'::jsonb)) c where c->>'status' in ('submitted','requested','ready_to_contract')) as al_carriers_inflight,
    (select string_agg(c->>'name' || ' [' || (c->>'status') || ']', ', ' order by c->>'name') from jsonb_array_elements(coalesce(x.al_carriers,'[]'::jsonb)) c where c->>'status' in ('incomplete_profile','pending_upline_assignment','issue','rejected','jail')) as al_carriers_blocked,
    (select count(*) from jsonb_array_elements(coalesce(x.al_carriers,'[]'::jsonb)) c where c->>'status' = 'incomplete_profile') as al_incomplete_profile_n,
    (select count(*) from jsonb_array_elements(coalesce(x.al_carriers,'[]'::jsonb)) c where c->>'status' = 'pending_upline_assignment') as al_pending_upline_n,
    (select count(*) from jsonb_array_elements(coalesce(x.al_carriers,'[]'::jsonb)) c where c->>'status' in ('rejected','issue','jail')) as al_rejected_n
  from x
)
select y.id as agent_id, y.display_name, y.email, y.phone, y.manager_name, y.status, y.is_inactive, y.license_status, y.recon_bucket,
       y.npn_db, y.npn_al, y.npn_ethos, y.npn_verdict, y.nipr_verified, y.dup_npn_with,
       y.comp_pct, y.ethos_status, y.ethos_level, y.ethos_level_expected, y.ethos_level_verdict, y.ethos_subagency, y.ethos_partner_id,
       y.al_id, y.al_approval, y.al_total, y.al_active, y.al_carriers_active, y.al_carriers_inflight, y.al_carriers_blocked,
       y.al_incomplete_profile_n, y.al_pending_upline_n, y.al_rejected_n, y.has_eo, y.eft_ready, y.contracted_at,
       case
         when y.dup_npn_with is not null then 'merge_duplicate_agent_rows'
         when y.license_status is distinct from 'licensed' then 'get_licensed'
         when y.npn_verdict in ('missing','invalid') then 'collect_real_npn'
         when y.npn_verdict = 'mismatch' then 'resolve_npn_conflict'
         when y.npn_verdict in ('db_blank_agentlink_has','db_blank_ethos_has') then 'backfill_npn_from_source'
         when y.ethos_status = 'subagency_head' then 'contracted_ok'
         when y.al_id is null then 'create_agentlink_profile'
         when y.al_incomplete_profile_n > 0 then 'complete_agentlink_profile'
         when y.al_pending_upline_n > 0 then 'upline_assign_in_agentlink'
         when y.al_rejected_n > 0 then 'fix_rejected_contracts'
         when y.ethos_status = 'not_on_sheet' then 'add_to_ethos_sheet'
         when y.ethos_status = 'needs_reparenting' then 'agent_sends_ethos_reparenting_email'
         when y.ethos_level_verdict in ('raw_or_blank','below_expected') then 'ethos_agent_update_comp_level'
         when y.ethos_status = 'on_sheet_pending' then 'waiting_on_ethos_portal'
         when coalesce(y.al_active,0) = 0 then 'no_active_carrier_contracts'
         when y.al_carriers_inflight is not null then 'carrier_contracts_in_flight'
         else 'contracted_ok'
       end as next_action,
       y.al_synced_at, y.ethos_synced_at
from y;

create view public.v_contracting_audit_summary
with (security_invoker = true) as
select next_action, count(*) as agents,
       count(*) filter (where license_status = 'licensed') as licensed,
       string_agg(display_name, ', ' order by display_name) as who
from public.v_contracting_audit
group by next_action
order by count(*) desc;

create view public.v_ethos_paste_rows
with (security_invoker = true) as
select display_name, split_part(display_name, ' ', 1) as "Agent First Name",
       nullif(btrim(substr(display_name, length(split_part(display_name, ' ', 1)) + 1)), '') as "Agent Last Name",
       coalesce(npn_db, npn_al) as "Agent NPN", '21346366' as "Direct Upline NPN", phone as "Agent Mobile Number", email as "Agent Email",
       ethos_level_expected as "Comp Level", '6 Month Advance' as "Advance Pay Tier",
       case when manager_name in ('Aisha Kebbeh','Chukwudi Ifediora','Chudi Ifediora','Kaeden Vaughns','KJ Vaughn','Obiajulu Ifediora') then
              case manager_name when 'KJ Vaughn' then 'Kaeden Vaughns' when 'Chudi Ifediora' then 'Chukwudi Ifediora' else manager_name end
            else 'Apex Financial Empire' end as "Sub-Agency Name",
       'FALSE' as "Sub-Agent Head?", 'TRUE' as "Life Licensed?", case when has_eo then 'TRUE' else 'FALSE' end as "$1M in E&O coverage?",
       '' as "Portal Created", '' as "Date Portal Created", '' as "Ethos Partner ID", '' as "Ethos Partner Code",
       'https://agents.ethoslife.com/invite/' as "Invite", '' as "Ethos Partnership Ops Notes",
       'level8financial@gmail.com apalejohnray@gmail.com' as "Comments"
from public.v_contracting_audit
where license_status = 'licensed' and ethos_status = 'not_on_sheet' and dup_npn_with is null
  and public.fn_npn_plausible(coalesce(npn_db, npn_al), phone)
order by manager_name, display_name;

create view public.v_ethos_agent_updates
with (security_invoker = true) as
select display_name, split_part(display_name, ' ', 1) as "Agent First Name",
       nullif(btrim(substr(display_name, length(split_part(display_name, ' ', 1)) + 1)), '') as "Agent Last Name",
       coalesce(npn_db, npn_ethos) as "Agent NPN", '' as "Direct Upline's NPN", ethos_level_expected as "Comp Level",
       '' as "Advanced Payments", '' as "PII Information", '' as "Termination", to_char(now() at time zone 'America/Phoenix', 'MM/DD/YYYY') as "Information submitted Date",
       ethos_level as current_sheet_level, comp_pct
from public.v_contracting_audit
where ethos_status not in ('not_on_sheet','subagency_head') and ethos_level_verdict in ('raw_or_blank','below_expected')
order by display_name;

grant select on public.v_contracting_audit, public.v_contracting_audit_summary, public.v_ethos_paste_rows, public.v_ethos_agent_updates to authenticated;

-- 5) Doctor critical: Marlyn Johnson's agent.hired never reached the outbox. Same rows the trigger writes.
insert into public.outbox_events (aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key, correlation_id)
select 'agent', a.id, 'agent.hired', d.dest,
       jsonb_strip_nulls(jsonb_build_object('agentName', a.display_name, 'agentCode', a.agent_code,
         'managerName', (select m.display_name from public.agents m where m.id = coalesce(a.invited_by_manager_id, a.manager_id)),
         'licenseStatus', a.license_status::text, 'contractingUrl', 'https://apex-financial.org/start-contracting',
         'openUrl', 'https://apex-financial.org/dashboard/profile?agentId=' || a.id::text)),
       'agent.hired:' || a.id::text || ':' || d.dest, gen_random_uuid()
from public.agents a cross join (values ('slack'), ('discord')) as d(dest)
where a.id = '390d953f-877e-4626-a601-273eaa28fa1d'
on conflict (idempotency_key) do nothing;

commit;
