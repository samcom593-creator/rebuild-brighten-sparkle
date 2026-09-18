-- MP-562 (2026-09-18) — premium parity between deals and agentlink_book.
--
-- WHY: MP-561 closed by naming its own limit:
--   "I proved the 1,532 corroborated deals exist in agentlink_book by
--    policy_number match ONLY -- I did NOT verify premium amounts agree
--    between the two, so 'present in the book' is not 'booked at the right
--    dollar'."
-- agentlink_book is the mirror of InsuraCloud's own book, the one commissions
-- are computed from. A deal present in it at the WRONG dollar underpays or
-- overpays an agent silently, and no check in the system compared the two.
--
-- MEASURED FIRST, and the answer was good news: on the 956 rows where the join
-- is provably 1:1, 955 agree to the cent. Exactly ONE disagrees (policy
-- 7gg62152, Wendell Funderburg / Dana Warnke: deals 1956.96 vs book 719.76).
-- This view exists so that result cannot silently rot -- not because a leak
-- was found.
--
-- TWO HEADLINES REFUSED IN GETTING HERE, both measured before being believed:
--   1. "One declined policy is in the book TEN times" -- true of the raw table,
--      and consequence ZERO: is_dead already reaps every repeat, and under a
--      strict key the LIVE population has zero duplicate groups (worst group
--      size = 1). No surface Sam reads was inflated.
--   2. "65 deals worth $77,698.32 match only DEAD book rows, so the import lane
--      dropped them" -- FALSE. is_dead is a pure function of policy status
--      (Lapsed/Lapse Pending/Declined/Withdrawn/Not Taken/Cancelled -> dead,
--      zero crossover). Those deals ARE in the destination book, correctly
--      recorded as dead policies. Excluding them would have moved the CFO
--      headline 39 -> 104 rows and $55,189.56 -> $132,887.88 on a phantom.
--      v_cfo_ghost_ap_verdict's unfiltered EXISTS is CORRECT for the
--      reconciliation question it asks, and is deliberately NOT modified here.
--
-- WHY IT DOES NOT JOIN v_ghost_deals: that view keys off carrier_policies, a
-- hand-pasted table frozen at 89 rows. This asks a different question and is
-- built independently so the two cannot drift into one operand with two
-- derivations (the curl/fn_agentlink_reap_stuck trap).
--
-- PROVABILITY IS THREE-VALUED AND NEVER LAUNDERED. A policy_number match is
-- only evidence when exactly one deal and one live book row carry that key.
-- Ambiguous and unmatched rows are reported as their own outcomes, never
-- folded into agree or disagree. 54 live policy keys are shared by DIFFERENT
-- clients (distinct deals colliding on a number -- correct to sum, but not
-- reconcilable per-row), which is why this matters.

create or replace function fn_book_parity_anchor() returns timestamptz
language sql immutable as $$ select '2026-09-18T10:45:00Z'::timestamptz $$;

comment on function fn_book_parity_anchor() is
'MP-562: the instant premium parity was first verified (955/956 provable joins agreeing). Disagreements on deals posted AFTER this are new faults and escalate; the one known pre-existing disagreement is reported as named context and clears only when the premium is corrected, never by the calendar.';

create or replace view v_book_premium_parity as
with d as (
  select d.id as deal_id, d.annual_premium as deal_ap, d.posted_at,
         lower(btrim(d.policy_number)) as pk
  from deals d
  where d.source = 'agent_link'
    and d.annual_premium is not null
    and d.policy_number is not null
    and btrim(d.policy_number) <> ''
    -- placeholder-shaped keys collapse distinct policies into one bucket and
    -- are a metadata fault owned elsewhere; they are not parity evidence.
    and not (btrim(d.policy_number) ~ '^0+$' or length(btrim(d.policy_number)) < 5)
),
dn as (select pk, count(*) n from d group by 1),
-- AMBIGUITY IS A PROPERTY OF THE KEY, NOT OF LIVENESS. An earlier cut of this
-- view counted only live rows here, so a policy number carried by one live and
-- one dead row looked provably 1:1 -- and reported two FALSE disagreements
-- (amh6325719, amh6331058), each a key shared by two DIFFERENT clients where
-- the deal legitimately matches the dead row. Caught by reading the rows back
-- instead of trusting the count. Count every row for the key; compare against
-- the single row when there is exactly one, dead or alive -- a policy that died
-- should still have been recorded at the right dollar.
b as (
  select lower(btrim(policy_number)) as pk, count(*) n, min(annual_premium) mn
  from agentlink_book
  where policy_number is not null and btrim(policy_number) <> ''
  group by 1
),
j as (
  select d.deal_id, d.deal_ap, d.posted_at, d.pk, b.n as book_n, b.mn as book_ap,
         (b.pk is not null and b.n = 1 and dn.n = 1) as provable
  from d join dn on dn.pk = d.pk left join b on b.pk = d.pk
)
select
  (select count(*) from j where provable)::integer as provable_rows,
  (select count(*) from j where provable and round(deal_ap::numeric,2) = round(book_ap::numeric,2))::integer as agree_rows,
  (select count(*) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2))::integer as disagree_rows,
  (select coalesce(sum(deal_ap),0)::numeric(14,2) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)) as disagree_deals_ap,
  (select coalesce(sum(book_ap),0)::numeric(14,2) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)) as disagree_book_ap,
  (select coalesce(max(abs(deal_ap - book_ap)),0)::numeric(14,2) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)) as worst_gap,
  -- movement operand: a disagreement on a deal posted since the anchor is NEW.
  (select count(*) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)
      and posted_at > fn_book_parity_anchor())::integer as disagree_rows_since_anchor,
  -- unprovable outcomes, reported as themselves (MP-313)
  (select count(*) from j where not provable and book_n is not null)::integer as ambiguous_rows,
  (select count(*) from j where book_n is null)::integer as unmatched_rows,
  (select string_agg(pk, ', ' order by pk) from j where provable
      and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)) as disagree_policies,
  case
    when (select count(*) from j where provable) = 0
      then '⚪ UNPROVEN — no provably 1:1 deal/book pair to compare. This is never an all-clear; it means the instrument could not look.'
    when (select count(*) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)
            and posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW DISAGREEMENT — ' || (select count(*) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2) and posted_at > fn_book_parity_anchor())::text
           || ' deal(s) posted since parity was verified carry a different annual premium than agentlink_book, the book commissions are computed from. Policies: '
           || coalesce((select string_agg(pk, ', ' order by pk) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2) and posted_at > fn_book_parity_anchor()), '(none)')
           || '. The import lane is writing wrong dollars NOW.'
    when (select count(*) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)) > 0
      then '🟡 KNOWN — ' || (select count(*) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2))::text
           || ' pre-anchor deal(s) disagree with the book: '
           || coalesce((select string_agg(pk, ', ' order by pk) from j where provable and round(deal_ap::numeric,2) <> round(book_ap::numeric,2)), '')
           || '. Static, not growing. Clears when the premium is corrected on one side, not by elapsed time. '
           || (select count(*) from j where provable and round(deal_ap::numeric,2) = round(book_ap::numeric,2))::text
           || ' of ' || (select count(*) from j where provable)::text || ' provable pairs agree to the cent.'
    else '🟢 OK — all ' || (select count(*) from j where provable)::text
           || ' provably 1:1 deal/book pairs agree to the cent. '
           || (select count(*) from j where not provable and book_n is not null)::text
           || ' ambiguous + ' || (select count(*) from j where book_n is null)::text
           || ' unmatched row(s) are reported unprovable, not counted as agreement.'
  end as verdict,
  now() as as_of;

comment on view v_book_premium_parity is
'MP-562: does a deal present in agentlink_book carry the SAME annual premium there? Answers MP-561s stated limit. Graded on movement vs fn_book_parity_anchor(); ambiguous and unmatched rows are their own outcomes and are never laundered into agreement.';
