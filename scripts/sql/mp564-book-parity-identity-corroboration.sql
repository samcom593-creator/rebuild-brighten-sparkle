-- MP-564 (2026-09-18): the policy rung paired two different customers and
-- called the difference in their premiums a booking error.
--
-- Check #79's ONLY complaint was policy 7gg62152. Measured on both sides:
--   deals          7GG62152  Robert Holmes  $1,956.96  posted 2026-06-10
--   agentlink_book 7GG62152  Dana Warnke    $  719.76  posted 2026-04-29
-- and Dana Warnke's 2026-04-29 deal exists in `deals` too -- under a different
-- policy number entirely (ARCF26090A111, $719.76, same day, same agent).
--
-- So the two rows the check compared are two different people's policies. The
-- premiums differ because the CUSTOMERS differ. Neither number is wrong. The
-- doctor was telling Sam "pick which side is right and correct it" about a
-- live commissions book -- a write that would have been wrong in either
-- direction, made on the authority of a pairing that was never real.
--
-- MP-563's ladder cannot catch this: the policy rung is evaluated FIRST and
-- returns before the client-composite rung is ever consulted, so the rung that
-- carries the client name is unreachable for exactly the rows that need it.
--
-- THE POLICY RUNG NOW REQUIRES CORROBORATION. A 1:1 policy match is evidence
-- only when both sides name the same client. Three outcomes, never two:
--   names present and equal     -> provable, compared on dollars
--   names present and different -> identity_conflict: reported with its own
--                                  remedy (decide who owns the number), never
--                                  compared on dollars, never called agreement
--   either name blank           -> uncorroborated: cannot look, published as
--                                  its own count, never folded into agreement
--
-- MEASURED BEFORE SHIPPING so the subtraction is known exactly: of 1,112
-- policy-rung pairs, 1,111 agree on the client, 1 conflicts, 0 have a blank
-- name on either side. This retires exactly the one false pair and nothing
-- else. The client-composite rung already carries the name in its key, so it
-- is structurally incapable of this fault and is left untouched.
--
-- NOT ALLOWED TO GO SILENTLY GREEN. Removing the false disagreement takes
-- disagree_rows 1 -> 0, and an all-clear there would launder a real fault into
-- a pass. The conflict is its own non-green state with its own count, its own
-- anchor comparison, and its own line in apex-doctor that is raised
-- INDEPENDENTLY of the disagreement branch -- not another rung on an elif
-- chain where the first match hides the rest (MP-322).
--
-- total_rows is published so the buckets must reconcile: provable + conflict +
-- uncorroborated + ambiguous + unmatched = total. A number that does not
-- reconcile is a defect, not a rounding error (MP-277).
create or replace view public.v_book_premium_parity as
with d as (
  select d.id as deal_id,
         d.annual_premium as deal_ap,
         d.posted_at,
         lower(btrim(d.policy_number)) as pk,
         lower(btrim(d.policy_number))||'~'||lower(btrim(coalesce(d.client_first_name,'')))||'|'||lower(btrim(coalesce(d.client_last_name,''))) as ck,
         btrim(lower(btrim(coalesce(d.client_first_name,'')))||' '||lower(btrim(coalesce(d.client_last_name,'')))) as dname
  from deals d
  where d.source::text = 'agent_link'
    and d.annual_premium is not null
    and d.policy_number is not null
    and btrim(d.policy_number) <> ''
    and not (btrim(d.policy_number) ~ '^0+$' or length(btrim(d.policy_number)) < 5)
), dnp as (select pk, count(*) as n from d group by pk),
   dnc as (select ck, count(*) as n from d group by ck),
   bp as (
  select lower(btrim(policy_number)) as pk,
         count(*) as n,
         min(annual_premium) as mn,
         -- min() over a 1-row group is that row's value; bpn=1 is enforced
         -- before this is read, so no cross-row mixing is possible.
         min(btrim(lower(btrim(coalesce(client_first_name,'')))||' '||lower(btrim(coalesce(client_last_name,''))))) as bname
  from agentlink_book
  where policy_number is not null and btrim(policy_number) <> ''
  group by lower(btrim(policy_number))
), bc as (
  select lower(btrim(policy_number))||'~'||lower(btrim(coalesce(client_first_name,'')))||'|'||lower(btrim(coalesce(client_last_name,''))) as ck,
         count(*) as n,
         min(annual_premium) as mn
  from agentlink_book
  where policy_number is not null and btrim(policy_number) <> ''
  group by lower(btrim(policy_number))||'~'||lower(btrim(coalesce(client_first_name,'')))||'|'||lower(btrim(coalesce(client_last_name,'')))
), j as (
  select d.deal_id, d.deal_ap, d.posted_at, d.pk, d.ck, d.dname,
         bp.n as bpn, bp.mn as bpm, bp.bname, dnp.n as dpn,
         bc.n as bcn, bc.mn as bcm, dnc.n as dcn
  from d
    join dnp on dnp.pk = d.pk
    join dnc on dnc.ck = d.ck
    left join bp on bp.pk = d.pk
    left join bc on bc.ck = d.ck
), v as (
  select j.*,
         (j.bpn is not null and j.bpn = 1 and j.dpn = 1) as pair_p,
         (j.bcn is not null and j.bcn = 1 and j.dcn = 1) as prov_c
  from j
), w as (
  select v.*,
         (v.pair_p and v.dname <> '' and coalesce(v.bname,'') <> '' and v.dname = v.bname) as prov_p,
         (v.pair_p and v.dname <> '' and coalesce(v.bname,'') <> '' and v.dname <> v.bname) as conflict_p,
         (v.pair_p and (v.dname = '' or coalesce(v.bname,'') = '')) as uncorrob_p
  from v
), u as (
  select w.*,
         case when w.prov_p then w.bpm when w.prov_c then w.bcm else null::numeric end as book_ap,
         (w.prov_p or w.prov_c) as provable,
         case when w.prov_p then 'policy' when w.prov_c then 'policy+client' else null::text end as key_used,
         (w.bpn is not null or w.bcn is not null) as seen_in_book,
         -- A conflict is only reportable as such when the client rung did not
         -- independently prove the row; prov_c wins because its key contains
         -- the name, so it cannot be pairing two different people.
         (w.conflict_p and not w.prov_c) as identity_conflict,
         (w.uncorrob_p and not w.prov_c) as uncorroborated
  from w
)
select
  (select count(*) from u where provable)::integer as provable_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::integer as agree_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::integer as disagree_rows,
  (select coalesce(sum(deal_ap),0)::numeric(14,2) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_deals_ap,
  (select coalesce(sum(book_ap),0)::numeric(14,2) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_book_ap,
  (select coalesce(max(abs(deal_ap - book_ap)),0)::numeric(14,2) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as worst_gap,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::integer as disagree_rows_since_anchor,
  (select count(*) from u where not provable and not identity_conflict and not uncorroborated and seen_in_book)::integer as ambiguous_rows,
  (select count(*) from u where not provable and not seen_in_book)::integer as unmatched_rows,
  (select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_policies,
  case
    when (select count(*) from u where provable) = 0
      then '⚪ UNPROVEN — no provably 1:1 deal/book pair to compare. This is never an all-clear; it means the instrument could not look.'
    when (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW DISAGREEMENT — '||(select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::text
           ||' deal(s) posted since parity was verified carry a different annual premium than agentlink_book, the book commissions are computed from. Policies: '
           ||coalesce((select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor()),'(none)')
           ||'. The import lane is writing wrong dollars NOW.'
    when (select count(*) from u where identity_conflict and posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW IDENTITY CONFLICT — '||(select count(*) from u where identity_conflict and posted_at > fn_book_parity_anchor())::text
           ||' policy number(s) written since the anchor name a DIFFERENT customer in deals than in agentlink_book: '
           ||coalesce((select string_agg(pk||' (deals: '||dname||' vs book: '||bname||')', '; ' order by pk) from u where identity_conflict and posted_at > fn_book_parity_anchor()),'(none)')
           ||'. Do not compare their premiums — reconcile which customer owns the number first.'
    when (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) > 0
      then '🟡 KNOWN — '||(select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::text
           ||' pre-anchor deal(s) disagree with the book: '||coalesce((select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)),'')
           ||'. Static, not growing. Clears when the premium is corrected on one side, not by elapsed time. '
           ||(select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::text||' of '
           ||(select count(*) from u where provable)::text||' provable pairs agree to the cent.'
    when (select count(*) from u where identity_conflict) > 0
      then '🟡 IDENTITY CONFLICT — '||(select count(*) from u where identity_conflict)::text
           ||' pre-anchor policy number(s) name a different customer in deals than in agentlink_book: '
           ||coalesce((select string_agg(pk||' (deals: '||dname||' vs book: '||bname||')', '; ' order by pk) from u where identity_conflict),'')
           ||'. Their premiums are NOT compared and neither side is called wrong — the two rows are different people. Clears when one system is corrected to name the right owner. '
           ||(select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::text||' of '
           ||(select count(*) from u where provable)::text||' corroborated pairs agree to the cent.'
    else '🟢 OK — all '||(select count(*) from u where provable)::text
         ||' corroborated 1:1 deal/book pairs agree to the cent. '
         ||(select count(*) from u where not provable and not identity_conflict and not uncorroborated and seen_in_book)::text||' ambiguous + '
         ||(select count(*) from u where not provable and not seen_in_book)::text||' unmatched row(s) are reported unprovable, not counted as agreement.'
  end as verdict,
  now() as as_of,
  (select count(*) from u where key_used = 'policy')::integer as provable_by_policy,
  (select count(*) from u where key_used = 'policy+client')::integer as provable_by_client_key,
  (select count(*) from u where identity_conflict)::integer as identity_conflict_rows,
  (select count(*) from u where identity_conflict and posted_at > fn_book_parity_anchor())::integer as identity_conflict_rows_since_anchor,
  (select string_agg(pk||' (deals: '||dname||' $'||round(deal_ap::numeric,2)||' vs book: '||bname||' $'||round(bpm,2)||')', '; ' order by pk)
     from u where identity_conflict) as identity_conflict_detail,
  (select count(*) from u where uncorroborated)::integer as uncorroborated_rows,
  (select count(*) from u)::integer as total_rows;
