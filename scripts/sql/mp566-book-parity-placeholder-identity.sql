-- MP-566 (2026-09-18) — the key you JOIN on and the key you JUDGE IDENTITY by are two
-- different questions, and collapsing them let English prose act as a policy number.
--
-- MP-565 closed with a stated LIMIT: it could not construct an adversarial case where two
-- genuinely distinct policies differing only in whitespace collapse to one key. Chasing
-- that hole found a larger one sitting in front of it, live.
--
-- WHAT WAS MEASURED (live prod, before any change):
--   * 50 of 1,261 "provable" pairs — $138,172.08 of annual premium — carry a policy number
--     that public.fn_policy_number_report_placeholder() already calls a placeholder. That
--     function is the house definition: it is what apex-doctor's production-integrity WARN
--     uses to tell a human "chase the real policy number before the commission run."
--   * 28 of the 50 reach `provable` through the POLICY rung, 22 through policy+client.
--   * The values are not marginal. `1234` is the policy number on 47 deals belonging to 46
--     DIFFERENT clients. `00000` on 19 across 12. Also live: `123456`, `12345`, `4321`,
--     `11111`, `131313`, `-----`, `Kdfhdbdj`, `Transamerica`, `Newbridge`, `Issued`,
--     `PENDING TEXAS` (three different customers), `WAITING ON CA CARRIER`.
--
-- WHY A FILTER WRITTEN TO REJECT THIS DID NOT: the house predicate's whitespace clause
-- (p ~ '\s') is what catches prose. MP-565 correctly moved the junk filter onto the
-- canonical key so a row could not clear a length bar on padding alone — but
-- fn_book_policy_key() strips ALL whitespace, so by the time any predicate reads the key,
-- 'PENDING TEXAS' has become 'pendingtexas': twelve characters, no whitespace, no leading
-- zeros. It passes every clause of a rule whose entire purpose was to reject it.
-- Normalization destroyed the evidence the filter needed. The view also reimplemented
-- three of the house rule's six clauses inline rather than calling it, so the two
-- definitions could drift without anything noticing — the same shape as curl's --max-time
-- drifting from fn_agentlink_reap_stuck into 36 false pages/day.
--
-- THE DISTINCTION THAT FIXES IT, and it is the whole wave: import padding and content
-- whitespace are not the same thing. Every one of the 7 cross-table pairs MP-565's rung
-- recovered differs by a LEADING OR TRAILING TAB around an otherwise identical number
-- (measured: deal side clean, book side '\t3000728' etc). Padding cannot distinguish two
-- policies and must be stripped to join. Internal whitespace is content, is how prose
-- announces itself, and must be preserved to judge. So identity is judged on the
-- DE-PADDED value — padding removed, internal structure intact — and the judging is
-- DELEGATED to the house function rather than restated. fn_book_policy_key() is untouched
-- and remains the join key.
--
-- This also closes MP-565's named hole as a side effect: two policy numbers differing by
-- internal whitespace can no longer be silently merged into one identity, because at
-- least one of them is a placeholder by the house rule and is excluded from both rungs.
--
-- WHAT THIS IS NOT. Nothing is leaking. All 50 pairs agree to the cent today, so no false
-- 🔴 is live and no money moved on a bad match. The costs are (a) coverage overstated —
-- 1,261/1,598 = 78.9% claimed vs 1,211/1,598 = 75.8% actually policy-identified, and
-- MP-565's celebrated gain was 0.5 points against a 3.1-point overstatement it inherited;
-- and (b) a latent misdiagnosis: a junk-keyed pair that ever disagreed would be announced
-- as "the import lane is writing wrong dollars NOW" when the truthful reading is "nobody
-- wrote a policy number, so we cannot tell whether the book is wrong or these are two
-- different policies." Different sentence, different remedy, different person.
--
-- THE SIGNAL IS NOT DISCARDED. Moving 50 rows out of `provable` would turn off an alarm if
-- their agreement simply stopped being checked. They keep being compared, in their own
-- bucket, with their own verdict branch and their own remedy. What changes is the claim
-- attached to the number, not whether the number is watched.
--
-- Restore path for the previous (MP-565) definition: mp565-book-parity-normalized-key.sql

-- Judge identity on the de-padded value. Two functions on purpose: fn_book_policy_key
-- answers "do these two rows refer to the same thing" (must erase padding), this answers
-- "did anyone actually write a policy number here" (must not). It DELEGATES to
-- fn_policy_number_report_placeholder so the house rule has exactly one definition; if a
-- clause is ever added there, this inherits it instead of drifting from it.
create or replace function public.fn_book_policy_identity_ok(p text)
returns boolean language sql immutable parallel safe as $$
  select not fn_policy_number_report_placeholder(
    btrim(replace(coalesce(p,''), chr(92)||'t', ''), E' \t\n\r')
  )
$$;

comment on function public.fn_book_policy_identity_ok(text) is
  'MP-566: true when a policy_number is a usable IDENTITY (not a house placeholder). Strips import padding (literal backslash-t, then edge whitespace) and delegates the verdict to fn_policy_number_report_placeholder. Deliberately preserves INTERNAL whitespace, which is how prose placeholders like "PENDING TEXAS" identify themselves and is the evidence fn_book_policy_key() necessarily destroys.';

create or replace view public.v_book_premium_parity as
with d as (
  select d.id as deal_id, d.annual_premium as deal_ap, d.posted_at,
         d.policy_number as d_raw,
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
    -- Junk filter stays on the CANONICAL key and stays exactly as MP-565 shipped it. It
    -- governs ELIGIBILITY (is this row in the denominator at all), which is a different
    -- question from identity. Placeholder-keyed rows deliberately REMAIN eligible: they
    -- are deals that ought to be parity-checkable and are not, so dropping them from
    -- total_rows would raise the coverage percentage by hiding the gap.
    and fn_book_policy_key(d.policy_number) <> ''
    and not (fn_book_policy_key(d.policy_number) ~ '^0+$'
             or length(fn_book_policy_key(d.policy_number)) < 5)
), dnp as (select pk, count(*) n from d group by pk),
   dnc as (select ck, count(*) n from d group by ck),
   b as (
     select fn_book_policy_key(policy_number) as pk,
            lower(btrim(coalesce(client_first_name,''))) as bfn,
            lower(btrim(coalesce(client_last_name,'')))  as bln,
            annual_premium, policy_number as b_raw
     from agentlink_book
     where policy_number is not null and fn_book_policy_key(policy_number) <> ''
   ),
   -- min() over these groups is exact wherever it is read: every consumer below requires
   -- n = 1 before using mn/bname/b_raw, so the aggregate always sees a single row. Same
   -- construction MP-565 shipped; b_raw rides along so identity can be judged on the BOOK
   -- side too, not only the deal side.
   bp as (select pk, count(*) n, min(annual_premium) mn,
                 min(btrim(bfn || ' ' || bln)) bname, min(b_raw) b_raw
          from b group by pk),
   bc as (select pk || '~' || bfn || '|' || bln as ck, count(*) n,
                 min(annual_premium) mn, min(b_raw) b_raw
          from b group by 1),
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
   j as (select d.*, bp.n bpn, bp.mn bpm, bp.bname, bp.b_raw bp_raw,
                dnp.n dpn, bc.n bcn, bc.mn bcm, bc.b_raw bc_raw, dnc.n dcn
         from d join dnp on dnp.pk = d.pk join dnc on dnc.ck = d.ck
         left join bp on bp.pk = d.pk left join bc on bc.ck = d.ck),
   v as (select j.*, (bpn is not null and bpn = 1 and dpn = 1) as pair_p,
                     (bcn is not null and bcn = 1 and dcn = 1) as pair_c from j),
   w as (select v.*,
           -- The matched book row for whichever rung would fire. Identity is judged on
           -- BOTH sides: a real number in deals paired against 'Issued' in the book is no
           -- more policy-identified than the reverse.
           case when pair_p then bp_raw when pair_c then bc_raw end as matched_b_raw
         from v),
   x as (select w.*,
           (fn_book_policy_identity_ok(d_raw)
            and fn_book_policy_identity_ok(coalesce(matched_b_raw, d_raw))) as ident_ok
         from w),
   y as (select x.*,
           -- Placeholder takes precedence over every other classification, including
           -- identity_conflict. Two different customers under the key '1234' is not a
           -- dispute over who owns a policy number; it is the absence of one. Calling it
           -- a conflict would send Sam to reconcile ownership of a number nobody wrote.
           (not ident_ok and (pair_p or pair_c)) as placeholder_key
         from x),
   z as (select y.*,
           (pair_p and ident_ok and dname <> '' and coalesce(bname,'') <> '' and dname =  bname) as prov_p,
           (pair_c and ident_ok)                                                                 as prov_c,
           (pair_p and ident_ok and dname <> '' and coalesce(bname,'') <> '' and dname <> bname) as conflict_p,
           (pair_p and ident_ok and (dname = '' or coalesce(bname,'') = ''))                     as uncorrob_p
         from y),
   u as (select z.*, (prov_p or prov_c) as provable,
           case when prov_p then bpm when prov_c then bcm end as book_ap,
           -- Rung-selected, NOT coalesce(bpm,bcm). bpm is min(annual_premium) over the
           -- whole pk group, which is exact only at n=1 -- the invariant stated above.
           -- A placeholder like '123456' has 12 book rows, so coalesce() compared each
           -- deal against the MINIMUM premium of twelve unrelated policies and reported
           -- 20 of the 50 as disagreements. Caught by reading the applied view back
           -- against the pre-change measurement (which said 0) instead of trusting it.
           case when placeholder_key and pair_p then bpm
                when placeholder_key and pair_c then bcm end as ph_book_ap,
           case when prov_p then 'policy' when prov_c then 'policy+client' end as key_used,
           (bpn is not null or bcn is not null) as seen_in_book,
           (conflict_p and not prov_c) as identity_conflict,
           (uncorrob_p and not prov_c) as uncorroborated
         from z)
select
  (select count(*) from u where provable)::int as provable_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) =  round(book_ap,2))::int as agree_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::int as disagree_rows,
  (select coalesce(sum(deal_ap),0) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::numeric(14,2) as disagree_deals_ap,
  (select coalesce(sum(book_ap),0) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::numeric(14,2) as disagree_book_ap,
  (select coalesce(max(abs(deal_ap - book_ap)),0) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::numeric(14,2) as worst_gap,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::int as disagree_rows_since_anchor,
  (select count(*) from u where not provable and not placeholder_key and not identity_conflict and not uncorroborated and seen_in_book)::int as ambiguous_rows,
  (select count(*) from u where not provable and not placeholder_key and not seen_in_book)::int as unmatched_rows,
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
    -- Deliberately BELOW the real-policy branches and deliberately not 🔴. A dollar gap on
    -- a pair nobody gave a policy number to cannot be attributed to the import lane; the
    -- remedy is to write the policy number, after which the pair is judged on its merits.
    when (select count(*) from u where placeholder_key and round(deal_ap::numeric,2) <> round(ph_book_ap,2)) > 0
      then '🟡 PLACEHOLDER DISAGREEMENT — ' || (select count(*) from u where placeholder_key and round(deal_ap::numeric,2) <> round(ph_book_ap,2))::text
           || ' deal/book pair(s) matched only by client name disagree on premium, and neither side carries a real policy number: '
           || coalesce((select string_agg(dname || ' [' || btrim(d_raw) || '] deals $' || round(deal_ap::numeric,2) || ' vs book $' || round(ph_book_ap,2), '; ' order by dname)
                 from u where placeholder_key and round(deal_ap::numeric,2) <> round(ph_book_ap,2)),'')
           || '. Do NOT correct a premium on this evidence — without a policy number there is no way to tell a wrong dollar from two different policies. Write the real policy number first.'
    else '🟢 OK — all ' || (select count(*) from u where provable)::text
           || ' corroborated 1:1 deal/book pairs agree to the cent. '
           || (select count(*) from u where placeholder_key)::text || ' further pair(s) agree but are matched by client name over a placeholder policy number ('
           || coalesce((select string_agg(distinct btrim(d_raw), ', ') from u where placeholder_key
                        and btrim(d_raw) in (select btrim(d_raw) from u where placeholder_key group by 1 order by count(*) desc limit 4)),'')
           || ' …) — counted separately, never as policy parity. '
           || (select count(*) from u where not provable and not placeholder_key and not identity_conflict and not uncorroborated and seen_in_book)::text || ' ambiguous + '
           || (select count(*) from u where not provable and not placeholder_key and not seen_in_book)::text
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
  (select string_agg(tbl || '.' || nk || ' <- {' || raws || '}', '; ' order by tbl, nk) from mg) as norm_merge_detail,
  -- MP-566. Published, not graded on a frozen count: this number moves the moment an agent
  -- types a real policy number, and it is the honest denominator correction for coverage.
  (select count(*) from u where placeholder_key)::int as placeholder_keyed_rows,
  (select count(*) from u where placeholder_key and round(deal_ap::numeric,2) =  round(ph_book_ap,2))::int as placeholder_keyed_agree,
  (select count(*) from u where placeholder_key and round(deal_ap::numeric,2) <> round(ph_book_ap,2))::int as placeholder_keyed_disagree,
  (select coalesce(sum(deal_ap),0) from u where placeholder_key)::numeric(14,2) as placeholder_keyed_ap,
  (select string_agg(v2.pn || ' x' || v2.n::text, ', ' order by v2.n desc, v2.pn)
     from (select btrim(d_raw) pn, count(*) n from u where placeholder_key group by 1) v2) as placeholder_keyed_detail;

comment on view public.v_book_premium_parity is
  'MP-566: deals<->agentlink_book annual-premium parity. provable_rows counts ONLY pairs whose policy number is a real identity on both sides (fn_book_policy_identity_ok). Pairs keyed on a house placeholder are matched by client name alone, counted in placeholder_keyed_* and never in provable/agree/disagree — they still get a verdict branch, so the check is narrowed, not switched off.';
