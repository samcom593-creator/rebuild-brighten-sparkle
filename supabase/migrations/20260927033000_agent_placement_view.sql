-- Per-agent placement health from the AgentLink book. Answers Sam's "tap an agent,
-- see what % is placing vs falling off." Placing = in-force; Falling = dead/never-took;
-- Progress = still underwriting; Unknown = unclassified (mostly legacy imports).
create or replace view public.v_agent_placement as
with b as (
  select agent_id,
    case
      when status in ('Active','Approved','Issued') then 'placing'
      when status in ('Lapsed','Lapse Pending','Declined','Withdrawn','Not Taken','Cancelled') then 'falling'
      when status in ('Pending','In Review') then 'progress'
      else 'unknown'
    end as bucket,
    coalesce(annual_premium,0) as alp
  from public.agentlink_book
  where agent_id is not null
)
select agent_id,
  count(*)::int as policies,
  round(sum(alp))::numeric as total_alp,
  count(*) filter (where bucket='placing')::int as placing_n,
  round(sum(alp) filter (where bucket='placing'))::numeric as placing_alp,
  count(*) filter (where bucket='falling')::int as falling_n,
  round(sum(alp) filter (where bucket='falling'))::numeric as falling_alp,
  count(*) filter (where bucket='progress')::int as progress_n,
  round(sum(alp) filter (where bucket='progress'))::numeric as progress_alp,
  count(*) filter (where bucket='unknown')::int as unknown_n,
  round(sum(alp) filter (where bucket='unknown'))::numeric as unknown_alp,
  -- rates computed over KNOWN book (placing+falling+progress); null when no known book
  round(100.0 * sum(alp) filter (where bucket='placing')
        / nullif(sum(alp) filter (where bucket in ('placing','falling','progress')),0))::int as placing_pct,
  round(100.0 * sum(alp) filter (where bucket='falling')
        / nullif(sum(alp) filter (where bucket in ('placing','falling','progress')),0))::int as falling_pct
from b group by agent_id;
grant select on public.v_agent_placement to authenticated;
