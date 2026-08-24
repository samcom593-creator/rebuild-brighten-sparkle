-- v_agentlink_book_scoped gains DEDUPLICATION on a strict identity key.
--
-- Sam: "I noticed same deals counted twice."  He is right — 52 rows / $95,058.
--
-- THE OBVIOUS FIX WAS WRONG AND WOULD HAVE COST $326,000 OF REAL PRODUCTION.
-- Duplicate policy_number looked like the key: 93 groups, 323 extra rows,
-- $382,918. But AgentLink's own /api/deals returns those rows too, each with a
-- DISTINCT deal id, and inspecting the 111 upstream repeat groups shows only 18
-- are actually identical. The rest differ by premium (83 groups), effective date
-- (79), client name (70) or even agent (34). policy_number is simply NOT unique
-- in AgentLink — it is reused across different clients and different sales.
-- Deduping on it would have deleted 83 groups of legitimately distinct deals and
-- understated the book by ~$326k. Verified against the live upstream payload
-- before writing this, not assumed from the shape of the data.
--
-- So the key is strict identity: same agent, same client, same premium, same
-- effective date, same carrier. Those 52 rows are the same sale entered more
-- than once in AgentLink. 49 of them sit in Sam's own book.
--
-- MEASURED IMPACT: lifetime $1,935,908 -> $1,840,850. Month-to-date is
-- UNCHANGED at 58 deals / $84,432 — this month contains no duplicates, so the
-- number Sam reads daily does not move.
--
-- Nothing is deleted. The rows stay in agentlink_book; the mirror stays a
-- faithful mirror of upstream, and the correction lives in the read path where
-- it can be reversed by replacing one view.
create or replace view public.v_agentlink_book_scoped
with (security_invoker = on) as
select distinct on (
  b.agent_name,
  lower(btrim(coalesce(b.client_name, ''))),
  b.annual_premium,
  b.effective_date,
  coalesce(b.carrier, '')
) b.*
from public.agentlink_book b
where not public.fn_agent_is_roster_excluded(b.agent_id)
order by
  b.agent_name,
  lower(btrim(coalesce(b.client_name, ''))),
  b.annual_premium,
  b.effective_date,
  coalesce(b.carrier, ''),
  -- newest revision wins, then deal_key so the choice is deterministic and the
  -- same row is picked on every read
  b.posted_date desc,
  b.deal_key;

grant select on public.v_agentlink_book_scoped to authenticated, anon;
