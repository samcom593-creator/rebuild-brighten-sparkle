-- PL-093: Surface per-agent pending referral earnings so /dashboard/referrals/mine
-- can show how much each referrer is owed but hasn't been paid yet, plus
-- lifetime totals (sent / converted / earned / paid).
--
-- A row exists for every agent that has ever submitted a referral (LEFT JOIN
-- guarantees zero-counts agents are dropped — the view is intentionally
-- referrer-only so it's small and indexable on referrer_agent_id).
create or replace view public.v_referral_earnings_pending as
select
  r.referrer_agent_id                                                     as agent_id,
  a.display_name                                                          as agent_name,
  count(*)                                                                as total_referrals,
  count(*) filter (where r.lifecycle = 'open')                            as open_count,
  count(*) filter (where r.lifecycle = 'closed_won')                      as won_count,
  count(*) filter (where r.lifecycle = 'closed_dead')                     as dead_count,
  coalesce(sum(r.bonus_owed_cents), 0)::bigint                            as bonus_owed_cents,
  coalesce(sum(r.bonus_paid_cents), 0)::bigint                            as bonus_paid_cents,
  greatest(coalesce(sum(r.bonus_owed_cents), 0)
         - coalesce(sum(r.bonus_paid_cents), 0), 0)::bigint               as bonus_pending_cents,
  max(r.created_at)                                                       as last_referral_at
from public.v_agent_referrals r
join public.agents a on a.id = r.referrer_agent_id
group by r.referrer_agent_id, a.display_name;

grant select on public.v_referral_earnings_pending to authenticated;
grant select on public.v_referral_earnings_pending to anon;

comment on view public.v_referral_earnings_pending is
  'PL-093: per-agent referral rollup. Used by /dashboard/referrals/mine to show pending bonus + lifetime stats.';
