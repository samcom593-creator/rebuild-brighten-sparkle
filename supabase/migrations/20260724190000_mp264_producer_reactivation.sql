-- MP-264 follow-on — Producer Reactivation ("easy pickins")
-- 2026-07-24
--
-- Sam directive: "going to my agent link, finding the people whose contracts
-- left off, having done production, etcetera ... so I can see there's easy
-- pickins to even bring back. The idea is to scale aggressively going into
-- next month."
--
-- WHAT THE DATA SAYS (measured 2026-07-24 against public.agentlink_book):
--   50 agents have ever produced. Only 20 produced in the last 30 days.
--   30 are dormant — 60% of everyone who has ever written business.
--   The top three lifetime producers ALL went dark inside 46 days:
--     Mahmod Imran     111 deals / $137,881 ALP / dark 37d
--     Michael Kayembe   65 deals /  $83,943 ALP / dark 30d
--     Dalton Rowland    76 deals /  $77,945 ALP / dark 42d
--   That is ~$300K of proven annual premium sitting idle in agents who
--   already know how to sell. Recruiting a replacement costs far more than
--   a phone call to someone with 111 closed deals.
--
-- Reactivation beats recruitment on every unit: no licensing spend, no
-- onboarding runway, no ramp. This view ranks who to call first.

create or replace view public.v_producer_reactivation as
with book as (
  select
    agent_name,
    count(*)            filter (where not coalesce(is_dead, false)) as deals,
    sum(annual_premium) filter (where not coalesce(is_dead, false)) as lifetime_alp,
    max(posted_date)    filter (where not coalesce(is_dead, false)) as last_deal_at,
    min(posted_date)    filter (where not coalesce(is_dead, false)) as first_deal_at,
    count(*)            filter (where not coalesce(is_dead, false)
                                  and posted_date >= current_date - 90) as deals_90d,
    sum(annual_premium) filter (where not coalesce(is_dead, false)
                                  and posted_date >= current_date - 90) as alp_90d
  from public.agentlink_book
  where agent_name is not null and btrim(agent_name) <> ''
  group by agent_name
),
scored as (
  select
    b.*,
    (current_date - b.last_deal_at)                                   as days_dark,
    round(b.lifetime_alp / nullif(b.deals, 0))                        as avg_alp_per_deal,
    -- Monthly run-rate while they were actually producing.
    -- The denominator is FLOORED AT 30 DAYS on purpose. Without that floor an
    -- agent who wrote 2 deals three days apart divides by 0.1 months and scores
    -- as a "$75,694/mo producer" — which is how Christopher Harris (2 deals,
    -- $2,523 lifetime) topped the first cut of this list. A burst is not a
    -- run-rate. Flooring makes the number mean "monthly ALP over their active
    -- span, and never more than their lifetime ALP."
    round(
      b.lifetime_alp
      / nullif(greatest(30, (b.last_deal_at - b.first_deal_at)) / 30.0, 0)
    )                                                                  as alp_per_month_when_active
  from book b
  where b.deals > 0
)
select
  s.agent_name,
  a.id                          as agent_id,
  a.display_name,
  a.status                      as agent_status,
  a.license_status,
  -- agents carries no contact columns; phone/email live on applications.
  ap.phone                      as agent_phone,
  ap.email                      as agent_email,
  ap.instagram_handle           as agent_instagram,
  s.deals,
  round(s.lifetime_alp)         as lifetime_alp,
  s.avg_alp_per_deal,
  s.alp_per_month_when_active,
  s.last_deal_at,
  s.first_deal_at,
  s.days_dark,
  s.deals_90d,
  round(coalesce(s.alp_90d, 0)) as alp_90d,

  -- Tiering. "Hot" = proven volume that went quiet recently enough that the
  -- relationship is still warm and their pipeline habits are intact.
  case
    when s.days_dark <= 25                     then 'active'
    when s.deals >= 20 and s.days_dark <= 60   then 'hot_winback'
    when s.deals >= 20 and s.days_dark <= 120  then 'proven_cold'
    when s.deals >= 5  and s.days_dark <= 60   then 'warm_winback'
    when s.deals >= 5                          then 'long_dormant'
    else 'light_producer'
  end as reactivation_tier,

  -- Rank by what is recoverable per call: monthly run-rate discounted by how
  -- long they have been gone. Recent + high-volume floats to the top.
  -- Recency-decayed run-rate, then damped by proven volume. The volume damper
  -- (deals/(deals+5)) stops thin books from outranking real producers: 2 deals
  -- keeps 29% of its score, 25 deals keeps 83%, 111 deals keeps 96%. Someone
  -- with 111 closed deals is a fundamentally safer call than someone with 2.
  round(
    coalesce(s.alp_per_month_when_active, 0)
    * exp(-1.0 * greatest(0, s.days_dark)::numeric / 90.0)
    * (s.deals::numeric / (s.deals + 5))
  ) as reactivation_score
from scored s
-- lateral + limit 1: agents has duplicate display_name rows (Loren Lail
-- appeared twice in the first cut). Prefer an active row over a terminated one.
left join lateral (
  select g.id, g.display_name, g.status, g.license_status
    from public.agents g
   where lower(btrim(g.display_name)) = lower(btrim(s.agent_name))
   order by (g.status = 'active') desc, g.id
   limit 1
) a on true
left join lateral (
  select p.phone, p.email, p.instagram_handle
    from public.applications p
   where lower(btrim(p.first_name || ' ' || p.last_name)) = lower(btrim(s.agent_name))
   order by p.created_at desc
   limit 1
) ap on true
where s.days_dark > 25
order by reactivation_score desc;

comment on view public.v_producer_reactivation is
  'MP-264: dormant producers ranked by recoverable monthly ALP. 60% of everyone '
  'who has ever produced at Apex is dark; the top 3 lifetime producers all went '
  'quiet inside 46 days. Reactivation is cheaper than recruitment on every unit.';
