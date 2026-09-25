begin;

-- MP-CONTRACTING-2 (2026-09-24). Sam: "fix contracting completely head to toe ... make sure all NPN
-- numbers are valid ... every single person has their contracts out and ready to go live ... everything
-- anchored, no gaps." Three sources disagreed and nothing compared them:
--   * agents.nipr_number          — self-reported at apply/intake time
--   * AgentLink downline-contracts — the NPN + per-carrier contract STATUS the carriers actually see
--   * the Ethos "Agent Portal Signup" sheet (level8financial's Google Sheet) — the Ethos hierarchy roster
-- The Google service credential for the sheet is gone (see apex_contracting_ethos_level_2026_09_16), so the
-- sheet is SNAPSHOTTED here from a read and the audit produces the exact rows to paste. AgentLink is
-- snapshotted from /api/hierarchy/downline-contracts (scripts/apex-agentlink-roster-sync.sh).

create table if not exists public.agentlink_roster (
  al_user_id       bigint primary key,
  first_name       text,
  last_name        text,
  email            text,
  phone            text,
  npn              text,
  depth            int,
  upline_al_id     bigint,
  approval_status  text,
  producer_active  boolean,
  deactivated_at   timestamptz,
  total_contracts  int,
  active_contracts int,
  carriers         jsonb not null default '[]'::jsonb,   -- [{name,status,level}] straight from AgentLink
  last_active_at   timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists agentlink_roster_email_idx on public.agentlink_roster (lower(email));

create table if not exists public.ethos_roster (
  id           bigserial primary key,
  first_name   text,
  last_name    text,
  npn          text,
  upline_npn   text,
  phone        text,
  email        text,
  comp_level   text,        -- "Level 12".."Level 27", or the raw "60"/"50" the old bug wrote, or blank
  advance      text,
  subagency    text,
  portal       text,        -- "7/20/2026" (portal created) | "needs reparenting" | blank
  partner_id   text,
  partner_code text,
  comment      text,
  source       text not null default 'drive_read',
  synced_at    timestamptz not null default now()
);
create index if not exists ethos_roster_email_idx on public.ethos_roster (lower(email));
create index if not exists ethos_roster_npn_idx on public.ethos_roster (npn);

alter table public.agentlink_roster enable row level security;
alter table public.ethos_roster enable row level security;
drop policy if exists agentlink_roster_staff_read on public.agentlink_roster;
create policy agentlink_roster_staff_read on public.agentlink_roster for select
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'manager'::app_role));
drop policy if exists ethos_roster_staff_read on public.ethos_roster;
create policy ethos_roster_staff_read on public.ethos_roster for select
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'manager'::app_role));

-- Ethos "Comp Level" from an APEX percentage: 60% = Level 12, one level per 5 points, clamped 12..27
-- (Compensation Grid tab of the sheet, 7/8/26). Same rule as _shared/ethos.ts ethosLevelForPct.
create or replace function public.fn_ethos_level_for_pct(pct numeric)
returns text language sql immutable as $$
  select 'Level ' || least(27, greatest(12, 12 + round((coalesce(pct, 60) - 60) / 5.0)))::int::text
$$;

-- An NPN that could be real: 4-10 digits, not a repeated digit, not a placeholder, and inside the range
-- NIPR has actually issued (individual NPNs are < 25,000,000 as of 2026; 397298017 and 3184013187 are not NPNs).
create or replace function public.fn_npn_plausible(npn text, phone text default null)
returns boolean language sql immutable as $$
  select npn is not null
     and npn ~ '^[0-9]{4,10}$'
     and npn !~ '^(.)\1+$'
     and npn not in ('12345','123456','1234567','00000','0000000')
     and npn::numeric between 1000 and 25000000
     and (phone is null or regexp_replace(phone, '[^0-9]', '', 'g') not like '%' || npn || '%')
$$;

create or replace view public.v_contracting_audit
with (security_invoker = true) as
with a as (
  select ag.id, ag.display_name, lower(p.email) as email, p.phone, ag.nipr_number as npn_db, ag.nipr_verified,
         ag.license_status, ag.status::text as status, ag.is_inactive, ag.canonical_agent_id, ag.al_user_id,
         ag.contracted_at, ag.eo_certificate_url is not null as has_eo, ag.eft_ready,
         coalesce((select l.contract_pct from public.agent_contract_levels l where l.agent_id = ag.id limit 1), ag.comp_percentage, 60)::numeric as comp_pct,
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
       or (a.al_user_id is null and lower(btrim(r.first_name) || ' ' || btrim(r.last_name)) = lower(a.display_name))
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
       or lower(btrim(e.first_name) || ' ' || btrim(e.last_name)) = lower(a.display_name)
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
         public.fn_npn_plausible(et.npn, a.phone) as npn_ethos_ok
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
      when x.npn_ethos is null and x.ethos_level is null then 'not_on_sheet'
      when x.ethos_partner_id is not null then 'portal_created'
      when x.ethos_portal ilike '%reparent%' then 'needs_reparenting'
      else 'on_sheet_pending'
    end as ethos_status,
    public.fn_ethos_level_for_pct(x.comp_pct) as ethos_level_expected,
    case
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
       y.npn_db, y.npn_al, y.npn_ethos, y.npn_verdict, y.nipr_verified,
       y.comp_pct, y.ethos_status, y.ethos_level, y.ethos_level_expected, y.ethos_level_verdict, y.ethos_subagency, y.ethos_partner_id,
       y.al_id, y.al_approval, y.al_total, y.al_active, y.al_carriers_active, y.al_carriers_inflight, y.al_carriers_blocked,
       y.al_incomplete_profile_n, y.al_pending_upline_n, y.al_rejected_n, y.has_eo, y.eft_ready, y.contracted_at,
       case
         when y.license_status is distinct from 'licensed' then 'get_licensed'
         when y.npn_verdict in ('missing','invalid') then 'collect_real_npn'
         when y.npn_verdict = 'mismatch' then 'resolve_npn_conflict'
         when y.npn_verdict in ('db_blank_agentlink_has','db_blank_ethos_has') then 'backfill_npn_from_source'
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

create or replace view public.v_contracting_audit_summary
with (security_invoker = true) as
select next_action, count(*) as agents,
       count(*) filter (where license_status = 'licensed') as licensed,
       string_agg(display_name, ', ' order by display_name) as who
from public.v_contracting_audit
group by next_action
order by count(*) desc;

-- Exact A..S row of the Ethos "agwnts" tab for every licensed agent with a plausible NPN who is not on it.
create or replace view public.v_ethos_paste_rows
with (security_invoker = true) as
select display_name, split_part(display_name, ' ', 1) as "Agent First Name",
       nullif(btrim(substr(display_name, length(split_part(display_name, ' ', 1)) + 1)), '') as "Agent Last Name",
       coalesce(npn_db, npn_al) as "Agent NPN", '21346366' as "Direct Upline NPN", phone as "Agent Mobile Number", email as "Agent Email",
       ethos_level_expected as "Comp Level", '6 Month Advance' as "Advance Pay Tier",
       case when manager_name in ('Aisha Kebbeh','Chukwudi Ifediora','Kaeden Vaughns','KJ Vaughn','Obiajulu Ifediora') then
              case manager_name when 'KJ Vaughn' then 'Kaeden Vaughns' else manager_name end
            else 'Apex Financial Empire' end as "Sub-Agency Name",
       'FALSE' as "Sub-Agent Head?", 'TRUE' as "Life Licensed?", case when has_eo then 'TRUE' else 'FALSE' end as "$1M in E&O coverage?",
       '' as "Portal Created", '' as "Date Portal Created", '' as "Ethos Partner ID", '' as "Ethos Partner Code",
       'https://agents.ethoslife.com/invite/' as "Invite", '' as "Ethos Partnership Ops Notes",
       'level8financial@gmail.com apalejohnray@gmail.com' as "Comments"
from public.v_contracting_audit
where license_status = 'licensed' and ethos_status = 'not_on_sheet'
  and public.fn_npn_plausible(coalesce(npn_db, npn_al), phone)
order by manager_name, display_name;

-- Rows for the sheet's "Agent Updates" tab: comp level corrections Ethos must process.
create or replace view public.v_ethos_agent_updates
with (security_invoker = true) as
select display_name, split_part(display_name, ' ', 1) as "Agent First Name",
       nullif(btrim(substr(display_name, length(split_part(display_name, ' ', 1)) + 1)), '') as "Agent Last Name",
       coalesce(npn_db, npn_ethos) as "Agent NPN", '' as "Direct Upline's NPN", ethos_level_expected as "Comp Level",
       '' as "Advanced Payments", '' as "PII Information", '' as "Termination", to_char(now() at time zone 'America/Phoenix', 'MM/DD/YYYY') as "Information submitted Date",
       ethos_level as current_sheet_level, comp_pct
from public.v_contracting_audit
where ethos_status <> 'not_on_sheet' and ethos_level_verdict in ('raw_or_blank','below_expected')
order by display_name;

grant select on public.v_contracting_audit, public.v_contracting_audit_summary, public.v_ethos_paste_rows, public.v_ethos_agent_updates to authenticated;

commit;
