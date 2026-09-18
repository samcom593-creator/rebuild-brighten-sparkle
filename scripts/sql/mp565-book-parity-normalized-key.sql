-- MP-565 (2026-09-18) — the normalization rung MP-564 refused to ship unmeasured.
--
-- MP-564 open(2) claimed 9 deals / $9,596.76 were unprovable ONLY because the policy
-- key is mangled, and refused to ship a normalization rung because "stripping characters
-- can merge two genuinely distinct policy numbers". That refusal was correct to demand a
-- measurement. The measurement was run (MP-565) and it corrected the operand:
--
--   * The recovery is 8 deals / $9,710.64, not 9 / $9,596.76. MP-564 counted the two
--     M003066530 rows as recoverable without checking them: deals holds that policy TWICE
--     and agentlink_book holds it TWICE (same client, same $720). They are a duplicate
--     pair, so they are not 1:1 on either side and stay unprovable under ANY key. MP-564
--     also did not count deal 3001284/John Gerorge, which the rung DOES recover.
--   * The feared hazard was measured and did not occur. Across both tables exactly ONE
--     normalized key collapses more than one distinct raw key: '3001284' <- {tab+'3001284',
--     '3001284'}. That is a mangled/clean pair of the SAME number, not two distinct
--     policies. Published every run as norm_merge_groups / norm_merge_detail below, so if
--     a future import ever merges two genuinely different numbers it cannot be invisible.
--   * Proven by per-row diff of the full ladder, raw key vs normalized key, over all
--     1,598 eligible deals: 8 rows gained provability, ZERO rows lost it, and
--     disagree_rows stayed 0 -- every recovered pair agrees to the cent.
--
-- WHY THIS IS SAFE EVEN IF A FUTURE MERGE IS WRONG. Normalization cannot manufacture a
-- false agreement. `provable` requires the client name to corroborate (MP-564's rung):
-- the policy rung demands dname = bname, and the composite rung puts the name IN the key.
-- So a wrong merge makes a row NOT 1:1, which lands it in `ambiguous` -- an unprovable
-- bucket that is never counted as agreement. The failure direction is conservative by
-- construction. That is the property that makes the rung shippable, not the fact that
-- today's only merge happens to be benign.
--
-- fn_book_policy_key() exists so the view, the filter, and any future consumer read ONE
-- definition of "the policy key". Two derivations of one question is how curl's
-- --max-time and fn_agentlink_reap_stuck drifted into 36 false pages/day.
--
-- Restore path for the previous (MP-564) definition: mp564-book-parity-identity-corroboration.sql

create or replace function public.fn_book_policy_key(p text)
returns text language sql immutable parallel safe as $$
  -- chr(92)='\'. deals stores the TWO-CHARACTER literal backslash-t where agentlink_book
  -- stores a real tab (measured: deals 2 literal / 0 real, book 0 literal / 10 real), so
  -- the literal sequence is removed BEFORE whitespace is stripped. btrim() alone cannot do
  -- this job: with no second argument it strips SPACES ONLY, so a real tab survives it.
  select lower(regexp_replace(replace(coalesce(p,''), chr(92)||'t', ''), '\s', '', 'g'))
$$;

comment on function public.fn_book_policy_key(text) is
  'MP-565: canonical policy-number key for deals<->agentlink_book reconciliation. Removes the 2-char literal backslash-t, then all whitespace, then lowercases. Single-sourced so the parity view and its filter cannot drift.';

create or replace view public.v_book_premium_parity as
with d as (
  select d.id as deal_id, d.annual_premium as deal_ap, d.posted_at,
         fn_book_policy_key(d.policy_number) as pk,
         fn_book_policy_key(d.policy_number) || '~'
           || lower(btrim(coalesce(d.client_first_name,''))) || '|'
           || lower(btrim(coalesce(d.client_last_name,'')))  as ck,
         btrim(lower(btrim(coalesce(d.client_first_name,''))) || ' '
               || lower(btrim(coalesce(d.client_last_name,'')))) as dname
  from deals d
  where d.source = 'agent_link'
    and d.annual_premium is not null
    and d.policy_number is not null
    -- Junk filter applied to the CANONICAL key, not the raw string. Proven inert today
    -- (total_rows 1598 under both forms) and correct for a future row whose raw form
    -- clears the length bar only because of padding.
    and fn_book_policy_key(d.policy_number) <> ''
    and not (fn_book_policy_key(d.policy_number) ~ '^0+$'
             or length(fn_book_policy_key(d.policy_number)) < 5)
), dnp as (select pk, count(*) n from d group by pk),
   dnc as (select ck, count(*) n from d group by ck),
   b as (
     select fn_book_policy_key(policy_number) as pk,
            lower(btrim(coalesce(client_first_name,''))) as bfn,
            lower(btrim(coalesce(client_last_name,'')))  as bln,
            annual_premium, policy_number as raw_policy
     from agentlink_book
     where policy_number is not null and fn_book_policy_key(policy_number) <> ''
   ),
   bp as (select pk, count(*) n, min(annual_premium) mn,
                 min(btrim(bfn || ' ' || bln)) bname
          from b group by pk),
   bc as (select pk || '~' || bfn || '|' || bln as ck, count(*) n, min(annual_premium) mn
          from b group by 1),
   -- Hazard publication. THE HAZARD IS WITHIN ONE TABLE, not across them. Collapsing a
   -- deals key onto a book key is the RUNG DOING ITS JOB -- the first cut of this counter
   -- unioned both tables and returned 9, counting all 8 intended recoveries as hazards,
   -- which would have published a number that treats the cure as the disease and hidden a
   -- real 10th merge in the noise. Caught by reading the applied view instead of trusting
   -- the apply. What can actually cost coverage is two DISTINCT policy numbers inside the
   -- SAME table collapsing to one key: that makes the side non-1:1, so its rows go
   -- unprovable. Today this is exactly 1 -- agentlink_book's tab-prefixed and clean copies
   -- of 3001284, a mangled pair of the SAME number. PUBLISHED, never graded on a frozen
   -- count: a guard pinned to a number it cannot move is a guard everybody learns to skip.
   mg as (
     select tbl, nk, count(distinct rawk) as k, string_agg(distinct rawk, ' || ') as raws
     from (
       select 'deals'::text tbl, fn_book_policy_key(policy_number) nk, lower(btrim(policy_number)) rawk
       from deals where source='agent_link' and policy_number is not null
       union all
       select 'agentlink_book', fn_book_policy_key(policy_number), lower(btrim(policy_number))
       from agentlink_book where policy_number is not null
     ) z
     where nk <> '' group by tbl, nk having count(distinct rawk) > 1
   ),
   j as (select d.*, bp.n bpn, bp.mn bpm, bp.bname, dnp.n dpn, bc.n bcn, bc.mn bcm, dnc.n dcn
         from d join dnp on dnp.pk = d.pk join dnc on dnc.ck = d.ck
         left join bp on bp.pk = d.pk left join bc on bc.ck = d.ck),
   v as (select j.*, (bpn is not null and bpn = 1 and dpn = 1) as pair_p,
                     (bcn is not null and bcn = 1 and dcn = 1) as prov_c from j),
   w as (select v.*,
           (pair_p and dname <> '' and coalesce(bname,'') <> '' and dname =  bname) as prov_p,
           (pair_p and dname <> '' and coalesce(bname,'') <> '' and dname <> bname) as conflict_p,
           (pair_p and (dname = '' or coalesce(bname,'') = ''))                     as uncorrob_p
         from v),
   u as (select w.*, (prov_p or prov_c) as provable,
           case when prov_p then bpm when prov_c then bcm end as book_ap,
           case when prov_p then 'policy' when prov_c then 'policy+client' end as key_used,
           (bpn is not null or bcn is not null) as seen_in_book,
           (conflict_p and not prov_c) as identity_conflict,
           (uncorrob_p and not prov_c) as uncorroborated
         from w)
select
  (select count(*) from u where provable)::int as provable_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) =  round(book_ap,2))::int as agree_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::int as disagree_rows,
  (select coalesce(sum(deal_ap),0) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::numeric(14,2) as disagree_deals_ap,
  (select coalesce(sum(book_ap),0) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::numeric(14,2) as disagree_book_ap,
  (select coalesce(max(abs(deal_ap - book_ap)),0) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::numeric(14,2) as worst_gap,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::int as disagree_rows_since_anchor,
  (select count(*) from u where not provable and not identity_conflict and not uncorroborated and seen_in_book)::int as ambiguous_rows,
  (select count(*) from u where not provable and not seen_in_book)::int as unmatched_rows,
  (select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_policies,
  case
    when (select count(*) from u where provable) = 0
      then '⚪ UNPROVEN — no provably 1:1 deal/book pair to compare. This is never an all-clear; it means the instrument could not look.'
    when (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW DISAGREEMENT — ' || (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::text
           || ' deal(s) posted since parity was verified carry a different annual premium than agentlink_book, the book commissions are computed from. Policies: '
           || coalesce((select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor()),'(none)')
           || '. The import lane is writing wrong dollars NOW.'
    when (select count(*) from u where identity_conflict and posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW IDENTITY CONFLICT — ' || (select count(*) from u where identity_conflict and posted_at > fn_book_parity_anchor())::text
           || ' policy number(s) written since the anchor name a DIFFERENT customer in deals than in agentlink_book: '
           || coalesce((select string_agg(pk || ' (deals: ' || dname || ' vs book: ' || bname || ')', '; ' order by pk) from u where identity_conflict and posted_at > fn_book_parity_anchor()),'(none)')
           || '. Do not compare their premiums — reconcile which customer owns the number first.'
    when (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) > 0
      then '🟡 KNOWN — ' || (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::text
           || ' pre-anchor deal(s) disagree with the book: '
           || coalesce((select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)),'')
           || '. Static, not growing. Clears when the premium is corrected on one side, not by elapsed time. '
           || (select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::text || ' of '
           || (select count(*) from u where provable)::text || ' provable pairs agree to the cent.'
    when (select count(*) from u where identity_conflict) > 0
      then '🟡 IDENTITY CONFLICT — ' || (select count(*) from u where identity_conflict)::text
           || ' pre-anchor policy number(s) name a different customer in deals than in agentlink_book: '
           || coalesce((select string_agg(pk || ' (deals: ' || dname || ' vs book: ' || bname || ')', '; ' order by pk) from u where identity_conflict),'')
           || '. Their premiums are NOT compared and neither side is called wrong — the two rows are different people. Clears when one system is corrected to name the right owner. '
           || (select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::text || ' of '
           || (select count(*) from u where provable)::text || ' corroborated pairs agree to the cent.'
    else '🟢 OK — all ' || (select count(*) from u where provable)::text
           || ' corroborated 1:1 deal/book pairs agree to the cent. '
           || (select count(*) from u where not provable and not identity_conflict and not uncorroborated and seen_in_book)::text || ' ambiguous + '
           || (select count(*) from u where not provable and not seen_in_book)::text
           || ' unmatched row(s) are reported unprovable, not counted as agreement.'
  end as verdict,
  now() as as_of,
  (select count(*) from u where key_used = 'policy')::int        as provable_by_policy,
  (select count(*) from u where key_used = 'policy+client')::int as provable_by_client_key,
  (select count(*) from u where identity_conflict)::int as identity_conflict_rows,
  (select count(*) from u where identity_conflict and posted_at > fn_book_parity_anchor())::int as identity_conflict_rows_since_anchor,
  (select string_agg(pk || ' (deals: ' || dname || ' $' || round(deal_ap::numeric,2) || ' vs book: ' || bname || ' $' || round(bpm,2) || ')', '; ' order by pk)
     from u where identity_conflict) as identity_conflict_detail,
  (select count(*) from u where uncorroborated)::int as uncorroborated_rows,
  (select count(*) from u)::int as total_rows,
  (select count(*) from mg)::int as norm_merge_groups,
  (select string_agg(tbl || '.' || nk || ' <- {' || raws || '}', '; ' order by tbl, nk) from mg) as norm_merge_detail;
