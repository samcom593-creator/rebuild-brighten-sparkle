-- v_producer_pulse — Sam: "make it easier to check downlines or agencies
-- production, or producers who live and go a day no sale."
--
-- One row per roster producer answering, at a glance: who sold today, who has
-- been quiet a day, three days, a week — and which leg/agency they sit in, so a
-- leader can check a downline without assembling it by hand.
--
-- Quiet is measured in BUSINESS days, not calendar days. A producer who sold
-- Friday is not "3 days quiet" on Monday morning, and a Sunday-morning list
-- flagging the entire team is a list nobody opens twice.
create or replace view public.v_producer_pulse
with (security_invoker = on) as
with today as (select (now() at time zone 'America/Phoenix')::date as d),
sales as (
  select coalesce(m.canonical_agent_id, b.agent_id) as canon,
         max(b.posted_date) as last_sale,
         count(*) filter (where b.posted_date = (select d from today))                    as deals_today,
         coalesce(sum(b.annual_premium) filter (where b.posted_date = (select d from today)), 0) as ap_today,
         count(*) filter (where b.posted_date >= (select d from today) - 7)               as deals_7d,
         coalesce(sum(b.annual_premium) filter (where b.posted_date >= (select d from today) - 7), 0)  as ap_7d,
         count(*) filter (where b.posted_date >= date_trunc('month', (select d from today))::date) as deals_mtd,
         coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('month', (select d from today))::date), 0) as ap_mtd
  from public.agentlink_book b
  left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
  where b.is_dead is not true
    and not public.fn_agent_is_roster_excluded(b.agent_id)
  group by 1
)
select
  r.id                                   as agent_id,
  r.display_name                         as agent_name,
  r.agent_code,
  r.manager_id,
  coalesce(mgr.display_name, 'Direct to Sam') as leg,
  r.license_status,
  r.roster_state,
  s.last_sale,
  ((select d from today) - s.last_sale)  as days_since_sale,
  -- business days quiet: weekends do not count against a producer
  (select count(*) from generate_series(
      coalesce(s.last_sale, (select d from today)) + 1, (select d from today), interval '1 day') g(day)
    where extract(isodow from g.day) < 6)::int as business_days_quiet,
  coalesce(s.deals_today, 0)::int         as deals_today,
  coalesce(s.ap_today, 0)                 as ap_today,
  coalesce(s.deals_7d, 0)::int            as deals_7d,
  coalesce(s.ap_7d, 0)                    as ap_7d,
  coalesce(s.deals_mtd, 0)::int           as deals_mtd,
  coalesce(s.ap_mtd, 0)                   as ap_mtd,
  case
    when coalesce(s.deals_today, 0) > 0 then 'sold_today'
    when s.last_sale is null            then 'never_sold'
    else (case
      when (select count(*) from generate_series(s.last_sale + 1, (select d from today), interval '1 day') g(day)
             where extract(isodow from g.day) < 6) >= 10 then 'cold'
      when (select count(*) from generate_series(s.last_sale + 1, (select d from today), interval '1 day') g(day)
             where extract(isodow from g.day) < 6) >= 5  then 'slipping'
      when (select count(*) from generate_series(s.last_sale + 1, (select d from today), interval '1 day') g(day)
             where extract(isodow from g.day) < 6) >= 1  then 'quiet'
      else 'sold_today' end)
  end as pulse
from public.v_apex_roster r
left join sales s on s.canon = r.id
left join public.agents mgr on mgr.id = r.manager_id
where r.is_producing            -- only people expected to be selling
order by (coalesce(s.deals_today,0) > 0) desc, s.last_sale desc nulls last;

grant select on public.v_producer_pulse to authenticated;

-- Leg / agency rollup so "check the downline" is one read, not a manual assembly.
create or replace view public.v_leg_production
with (security_invoker = on) as
select
  leg,
  count(*)::int                                   as producers,
  count(*) filter (where pulse = 'sold_today')::int as sold_today,
  count(*) filter (where pulse = 'quiet')::int      as quiet,
  count(*) filter (where pulse = 'slipping')::int   as slipping,
  count(*) filter (where pulse = 'cold')::int       as cold,
  sum(ap_today)                                    as ap_today,
  sum(ap_7d)                                       as ap_7d,
  sum(ap_mtd)                                      as ap_mtd,
  max(last_sale)                                   as leg_last_sale
from public.v_producer_pulse
group by leg
order by sum(ap_mtd) desc nulls last;

grant select on public.v_leg_production to authenticated;
