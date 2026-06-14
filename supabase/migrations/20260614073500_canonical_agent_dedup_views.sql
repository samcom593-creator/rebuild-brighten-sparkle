-- wave-93: DB-level Samuel James (SJAMES01/02) dedup at view layer.
-- canonical_agent_id has been on agents since the canonical_agent_id column existed,
-- but no public view used it. Result: any agent with a marked duplicate (today: only
-- SJAMES02 → SJAMES01) appeared twice on every leaderboard, pipeline, book of
-- business surface that wasn't manually patched at the component level.
-- Fix: rewrite v_recruiting_leaderboard + v_recruiter_pipeline to canonicalize
-- the agent key via v_agent_canonical_map. Add v_agent_duplicates so admins can see
-- which agent_ids are dups + which canonical they roll into.

-- 1) Canonicalized recruiting leaderboard.
--    Aggregate applications by COALESCE(referral_recruiter_id, referral_manager_id)
--    after canonical-resolving each agent_id through v_agent_canonical_map.
drop view if exists public.v_recruiting_leaderboard cascade;
create view public.v_recruiting_leaderboard as
with src as (
  select
    coalesce(m.canonical_agent_id, a.referral_recruiter_id, a.referral_manager_id) as recruiter_id,
    a.created_at
  from applications a
  left join v_agent_canonical_map m
    on m.agent_id = coalesce(a.referral_recruiter_id, a.referral_manager_id)
  where coalesce(a.referral_recruiter_id, a.referral_manager_id) is not null
    and a.terminated_at is null
)
select
  recruiter_id,
  count(*) filter (where created_at >= current_date) as today,
  count(*) filter (where created_at >= date_trunc('week', current_date::timestamptz)) as this_week,
  count(*) filter (where created_at >= date_trunc('month', current_date::timestamptz)) as this_month,
  count(*) filter (where created_at >= now() - interval '30 days') as last_30d
from src
group by recruiter_id;

-- 2) Canonicalized recruiter pipeline.
--    Filter agents to canonical rows only (canonical_agent_id IS NULL) and aggregate
--    child applications by joining assigned_agent_id through v_agent_canonical_map.
drop view if exists public.v_recruiter_pipeline cascade;
create view public.v_recruiter_pipeline as
select
  ag.id as recruiter_id,
  ag.agent_code,
  p.email as recruiter_email,
  ag.display_name as recruiter_name,
  count(a.id)::int as total_assigned,
  count(*) filter (where a.status::text = any (array['new'::text, 'lead'::text]))::int as new_count,
  count(*) filter (where a.status::text = any (array['reviewing'::text, 'interview'::text]))::int as in_progress_count,
  count(*) filter (where a.status::text = 'contracting'::text)::int as contracting_count,
  count(*) filter (where a.ica_paid = true)::int as paid_count,
  count(*) filter (where a.status::text = 'rejected'::text)::int as rejected_count,
  count(*) filter (where a.contacted_at is null and a.created_at < now() - interval '3 days')::int as stale_no_contact,
  count(*) filter (
    where a.contacted_at is not null
      and a.contacted_at < now() - interval '7 days'
      and a.status::text <> all (array['rejected'::text, 'approved'::text, 'no_pickup'::text])
  )::int as ghosting_risk,
  max(a.contacted_at) as last_contact_made,
  ag.total_premium,
  ag.total_earnings,
  ag.total_policies
from agents ag
left join profiles p on p.id = ag.profile_id
left join v_agent_canonical_map m on m.canonical_agent_id = ag.id
left join applications a on a.assigned_agent_id = m.agent_id
where ag.is_deactivated is not true
  and ag.canonical_agent_id is null  -- exclude duplicate rows; SJAMES02 rolls into SJAMES01
group by ag.id, ag.agent_code, p.email, ag.display_name, ag.total_premium, ag.total_earnings, ag.total_policies
order by count(a.id)::int desc, ag.total_premium desc nulls last;

-- 3) Duplicate-agent visibility view.
--    Lists every dup → canonical pair so admins can audit + apex-doctor can canary.
create or replace view public.v_agent_duplicates as
select
  dup.id as dup_agent_id,
  dup.agent_code as dup_agent_code,
  dup.display_name as dup_display_name,
  dup.created_at as dup_created_at,
  dup.al_user_id as dup_al_user_id,
  canon.id as canonical_agent_id,
  canon.agent_code as canonical_agent_code,
  canon.display_name as canonical_display_name,
  canon.created_at as canonical_created_at,
  canon.al_user_id as canonical_al_user_id
from agents dup
join agents canon on canon.id = dup.canonical_agent_id
where dup.canonical_agent_id is not null
order by dup.display_name, dup.created_at;

comment on view public.v_recruiting_leaderboard is
  'wave-93 (2026-06-14): aggregate applications by canonical agent_id via v_agent_canonical_map. Duplicate agent rows (canonical_agent_id IS NOT NULL) roll into their canonical row instead of appearing as separate leaderboard entries.';
comment on view public.v_recruiter_pipeline is
  'wave-93 (2026-06-14): canonical agents only (canonical_agent_id IS NULL). Child applications join through v_agent_canonical_map so dup-routed work attributes to canonical row.';
comment on view public.v_agent_duplicates is
  'wave-93 (2026-06-14): one row per dup→canonical pair (where agents.canonical_agent_id IS NOT NULL). Read by /admin auditing surfaces + apex-doctor Check #13 as the canary against silent dedup regression.';
