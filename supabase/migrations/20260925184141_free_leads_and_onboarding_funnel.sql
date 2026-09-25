-- Free-leads qualification + onboarding funnel, both security_invoker (admin surface).
-- Free-leads reads v_production_canonical (the LIVE feed, current to today) NOT the
-- frozen agentlink_book snapshot. Rule (Sam 2026-09-25): an agent earns free leads
-- if, over the trailing 30 days counting weekdays only, production >= $20,000 AND
-- IP'd/verified production >= $15,000. "Verified/IP'd" = production carrying a
-- policy number (Sam: "verified production in terms of having policy numbers").

create or replace view public.v_free_leads_qualification
with (security_invoker = true) as
select
  c.agent_id,
  max(c.agent_name)                                            as agent_name,
  count(*)                                                     as deals_30d,
  round(coalesce(sum(c.annual_premium), 0))::numeric           as production_30d,
  round(coalesce(sum(c.annual_premium) filter (
    where c.policy_number is not null and btrim(c.policy_number) <> ''
  ), 0))::numeric                                              as ipd_verified_30d,
  20000::numeric                                               as production_threshold,
  15000::numeric                                               as ipd_threshold,
  (
    coalesce(sum(c.annual_premium), 0) >= 20000
    and coalesce(sum(c.annual_premium) filter (
      where c.policy_number is not null and btrim(c.policy_number) <> ''
    ), 0) >= 15000
  )                                                            as qualifies_free_leads,
  greatest(0, 20000 - coalesce(sum(c.annual_premium), 0))::numeric as production_gap,
  greatest(0, 15000 - coalesce(sum(c.annual_premium) filter (
    where c.policy_number is not null and btrim(c.policy_number) <> ''
  ), 0))::numeric                                              as ipd_gap,
  max(c.posted_date)                                           as last_deal_date
from public.v_production_canonical c
where c.posted_date >= (current_date - interval '30 days')
  and c.posted_date <= current_date
  and extract(dow from c.posted_date) not in (0, 6)   -- exclude Saturday/Sunday
  and c.agent_id is not null
group by c.agent_id;

comment on view public.v_free_leads_qualification is
  'Per-agent free-leads qualification. Trailing 30 days, weekdays only. Qualifies = production_30d >= 20000 AND ipd_verified_30d >= 15000. IP''d/verified = production carrying a policy number. Source: v_production_canonical (live).';

create or replace view public.v_free_leads_summary
with (security_invoker = true) as
select
  (select count(*) from public.v_free_leads_qualification)                                          as producing_agents_30d,
  (select count(*) from public.v_free_leads_qualification where qualifies_free_leads)                as qualifying_agents,
  (select count(*) from public.v_free_leads_qualification where not qualifies_free_leads
                                                             and production_30d > 0)                 as not_yet_qualifying,
  20000::numeric                                                                                     as production_threshold,
  15000::numeric                                                                                     as ipd_threshold,
  30                                                                                                 as window_days,
  'Trailing 30 days, weekdays only. Qualifies at $20k production AND $15k verified (policy-numbered) production.' as rule;

-- Onboarding / contracting funnel: the ordered contracting pipeline with a count
-- of live agents parked at each stage, who owns the next move, and how far through
-- the process that stage sits. Powers the visual "where are our contracts landing"
-- board. Source: v_contracting_audit (one next_action per live agent).

create or replace view public.v_onboarding_funnel
with (security_invoker = true) as
with stages(stage_key, stage_order, owner, label) as (values
  ('get_licensed',                     1,  'Agent',   'Get licensed'),
  ('collect_real_npn',                 2,  'Agent',   'Collect a real NPN'),
  ('resolve_npn_conflict',             3,  'Sam',     'Resolve NPN conflict'),
  ('backfill_npn_from_source',         4,  'Sam',     'Backfill NPN from source'),
  ('merge_duplicate_agent_rows',       5,  'Sam',     'Merge duplicate agent rows'),
  ('create_agentlink_profile',         6,  'Sam',     'Create AgentLink profile'),
  ('complete_agentlink_profile',       7,  'Sam',     'Complete AgentLink profile'),
  ('upline_assign_in_agentlink',       8,  'Sam',     'Assign upline in AgentLink'),
  ('fix_rejected_contracts',           9,  'Sam',     'Fix rejected carrier contracts'),
  ('no_active_carrier_contracts',      10, 'Sam',     'No active carrier contract'),
  ('carrier_contracts_in_flight',      11, 'Carrier', 'Carrier contracts in flight'),
  ('add_to_ethos_sheet',               12, 'Sam',     'Add to Ethos sheet'),
  ('agent_sends_ethos_reparenting_email', 13, 'Agent', 'Agent emails Ethos (reparenting)'),
  ('ethos_agent_update_comp_level',    14, 'Sam',     'Fix Ethos comp level'),
  ('waiting_on_ethos_portal',          15, 'Ethos',   'Waiting on Ethos portal'),
  ('contracted_ok',                    16, 'Done',    'Contracted · ready to write')
),
cnt as (
  select next_action,
         count(*) as n,
         count(*) filter (where license_status::text = 'licensed') as licensed
  from public.v_contracting_audit group by 1
),
tot as (select greatest(count(*), 1)::numeric as total from public.v_contracting_audit)
select
  s.stage_key,
  s.stage_order,
  s.owner,
  s.label,
  coalesce(c.n, 0)                                              as agents,
  coalesce(c.licensed, 0)                                       as licensed,
  round(coalesce(c.n, 0) / (select total from tot) * 100, 1)    as pct_of_agents,
  round(s.stage_order::numeric / 16 * 100)                      as pct_complete_at_stage
from stages s
left join cnt c on c.next_action = s.stage_key
order by s.stage_order;

create or replace view public.v_onboarding_funnel_summary
with (security_invoker = true) as
select
  (select count(*) from public.v_contracting_audit)                                          as live_agents,
  (select count(*) from public.v_contracting_audit where next_action = 'contracted_ok')      as fully_contracted,
  (select count(*) from public.v_contracting_audit where next_action in (
     'resolve_npn_conflict','backfill_npn_from_source','merge_duplicate_agent_rows',
     'create_agentlink_profile','complete_agentlink_profile','upline_assign_in_agentlink',
     'fix_rejected_contracts','no_active_carrier_contracts','add_to_ethos_sheet',
     'ethos_agent_update_comp_level'))                                                        as waiting_on_sam,
  (select count(*) from public.v_contracting_audit where next_action in (
     'get_licensed','collect_real_npn','agent_sends_ethos_reparenting_email'))                as waiting_on_agent,
  (select count(*) from public.v_contracting_audit where next_action in (
     'carrier_contracts_in_flight','waiting_on_ethos_portal'))                                as waiting_external;
