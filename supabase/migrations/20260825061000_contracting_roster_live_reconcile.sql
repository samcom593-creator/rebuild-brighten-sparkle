-- Authorized roster-to-contracting reconciliation. This is intentionally
-- separate from dashboard truth: it queues real external Sheet/Discord work.
-- Sam explicitly requested the active team's contracting records be delivered.
begin;

insert into public.system_settings(key, value)
values ('discord_invite_url', 'https://discord.gg/JpUWA73UZX')
on conflict (key) do update set value = excluded.value;

-- The live workbook's agent tab is literally named "agwnts" (gid 517020732).
insert into public.system_settings(key, value)
values ('ethos_agents_sheet', jsonb_build_object(
  'sheet_id', '1R5ZEjfDai0dFp1z8xbfpaFGbOAEiXzPc0F1KxnWPSMY',
  'tab', 'agwnts',
  'direct_upline_npn', '21346366',
  'advance_pay_tier', '6 Month Advance',
  'sub_agency_name', 'Apex Financial Empire',
  'comment_prefix', 'Apex Financial Empire / Level 8 Financial'
)::text)
on conflict (key) do update set value = excluded.value;

create temporary table tmp_contracting_roster_candidates on commit drop as
with raw as (
  select
    r.id as agent_id,
    coalesce(nullif(btrim(app.first_name), ''), split_part(btrim(coalesce(p.full_name, r.display_name)), ' ', 1)) as first_name,
    coalesce(
      nullif(btrim(app.last_name), ''),
      nullif(btrim(regexp_replace(btrim(coalesce(p.full_name, r.display_name)), '^\S+\s*', '')), '')
    ) as last_name,
    public.fn_normalize_contracting_email(coalesce(nullif(app.email, ''), p.email)) as email,
    public.fn_normalize_contracting_phone(coalesce(nullif(app.phone, ''), p.phone)) as phone_e164,
    public.fn_normalize_contracting_npn(coalesce(nullif(a.nipr_number, ''), app.nipr_number)) as npn
  from public.v_apex_roster r
  join public.agents a on a.id = r.id
  left join public.applications app on app.id = a.source_application_id
  left join public.profiles p on p.id = a.profile_id
  where r.license_status = 'licensed'
), valid as (
  select *, count(*) over (partition by npn) as npn_count,
         count(*) over (partition by email) as email_count
  from raw
  where first_name is not null and btrim(first_name) <> ''
    and last_name is not null and btrim(last_name) <> ''
    and email is not null and email like '%_@_%.__%'
    and phone_e164 is not null
    and npn ~ '^[0-9]{5,10}$'
)
select * from valid where npn_count = 1;

insert into public.contracting_intakes(
  first_name, last_name, email, phone_e164, npn,
  status, review_reason, idempotency_key, source
)
select
  c.first_name, c.last_name, c.email, c.phone_e164, c.npn,
  case when c.email_count > 1 or exists (
    select 1 from public.contracting_intakes i where i.email = c.email and i.npn <> c.npn
  ) then 'needs_review' else 'accepted' end,
  case when c.email_count > 1 or exists (
    select 1 from public.contracting_intakes i where i.email = c.email and i.npn <> c.npn
  ) then 'email_matches_a_different_npn' else null end,
  'contracting-intake-' || c.npn, 'active_roster_reconcile_20260825'
from tmp_contracting_roster_candidates c
on conflict (npn) do nothing;

with eligible as (
  select i.id, i.status from tmp_contracting_roster_candidates c
  join public.contracting_intakes i on i.npn = c.npn
), destinations as (
  select e.id, e.status, d.destination from eligible e
  cross join (values ('ethos_sheet'::text), ('contracting_discord'::text)) d(destination)
)
insert into public.contracting_intake_deliveries(intake_id, destination, state)
select id, destination,
       case when destination = 'ethos_sheet' and status = 'needs_review'
            then 'manual_review' else 'queued' end
from destinations
on conflict (intake_id, destination) do nothing;

with eligible as (
  select i.id, i.status from tmp_contracting_roster_candidates c
  join public.contracting_intakes i on i.npn = c.npn
), destinations as (
  select e.id, e.status, d.destination from eligible e
  cross join (values ('ethos_sheet'::text), ('contracting_discord'::text)) d(destination)
)
insert into public.outbox_events(
  aggregate_type, aggregate_id, event_type, destination, payload, idempotency_key
)
select 'contracting_intake', id, 'contracting_intake_submitted', destination,
       jsonb_build_object('intake_id', id, 'destination', destination),
       'contracting-' || id::text || '-' || destination
from destinations
where not (destination = 'ethos_sheet' and status = 'needs_review')
on conflict (idempotency_key) do nothing;

commit;
