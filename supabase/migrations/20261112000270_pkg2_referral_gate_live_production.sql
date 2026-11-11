-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 9 of 10: the referral gate reads live production.
--
-- WHAT
--   my_referral_status(): same JSON keys, same policy (system_settings.referral_unlock_threshold, $20,000, set by Sam
--   on 08-01; NOT changed here), but production_total is the person's lifetime annual premium in
--   mat_production_unified (every live origin, every agent row of the person) instead of the frozen AgentLink book.
--   Adds 'production_source'. The agent portal referral card (src/components/agent/EliteReferralUnlock.tsx) now reads
--   this one function instead of its own hard-coded $10,000 month-to-date sum over native deals.
--   anon loses EXECUTE (it only ever returned has_agent=false to a signed-out caller).
--
-- WHY
--   shipped_vs_live 6.13 / DECISIONS "Referral gate": AgentLink was retired 11-10 (the book is frozen), so the gate
--   counted a stale number; on live production the $20,000 gate is open for 11 active agents instead of 8. Agent
--   referral links produced 11 of the last 28 applications.

create or replace function public.my_referral_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (
    select a.id, a.ref_slug, coalesce(pr.full_name, a.display_name) nm,
           coalesce(nullif(a.canonical_agent_id, a.id), a.id) as person_id
    from public.agents a
    left join public.profiles pr on pr.id = a.user_id
    where a.user_id = auth.uid()
    order by (a.canonical_agent_id is null or a.canonical_agent_id = a.id) desc, a.created_at
    limit 1),
  thresh as (select coalesce((select value::numeric from public.system_settings where key='referral_unlock_threshold'),20000) t),
  prod as (
    -- live production (mat_production_unified: apex_native, agentlink history, external feeds), every agent row of
    -- the person; the AgentLink book stopped updating when AgentLink was retired on 2026-11-10
    select coalesce(sum(m.annual_premium),0) ap
    from public.mat_production_unified m
    join public.agents x on x.id = m.agent_id
    join me on coalesce(nullif(x.canonical_agent_id, x.id), x.id) = me.person_id),
  refs as (select count(*) n from public.referrals r, me where r.referrer_agent_id = me.id)
  select jsonb_build_object(
    'has_agent', (select count(*) from me) > 0,
    'ref_slug', (select ref_slug from me),
    'full_name', (select nm from me),
    'production_total', (select ap from prod),
    'threshold', (select t from thresh),
    'unlocked', (select ap from prod) >= (select t from thresh),
    'remaining', greatest((select t from thresh) - (select ap from prod), 0),
    'referrals_count', (select n from refs),
    'link', case when (select ref_slug from me) is not null
                 then 'https://apex-financial.org/r/' || (select ref_slug from me) end,
    'production_source', 'mat_production_unified')
$$;

comment on function public.my_referral_status() is
  'Referral link gate for the signed-in agent. Policy: lifetime production >= system_settings.referral_unlock_threshold ($20,000, Sam 2026-08-01). PKG2 (2026-11-12): production read from mat_production_unified (live), not the frozen AgentLink book.';

revoke all on function public.my_referral_status() from public, anon;
grant execute on function public.my_referral_status() to authenticated, service_role;
