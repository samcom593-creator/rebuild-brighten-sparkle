-- MP-567 (2026-09-18): the "ambiguous" bucket was three questions wearing one word.
--
-- MP-566 closed naming its own limit: "I did not re-measure the 305 ambiguous rows
-- under the narrowed definition", and listed the 305 ambiguous + 31 unmatched rows
-- as "still unprovable and uninspected for dollar disagreement".
--
-- MEASURED. The 31 unmatched rows are correctly labelled: all 31 carry a REAL policy
-- number (fn_book_policy_identity_ok = true), none appear in agentlink_book on any
-- key, all are pre-anchor, and with no book row to compare there is nothing hiding in
-- them. That half of the open item is confirmed and closed, not fixed.
--
-- The 305 ambiguous rows were NOT correctly labelled, and the reason is structural:
-- all THREE of this view's classified states require a 1:1 pairing.
--   provable        := pair_p OR pair_c
--   identity_conflict := pair_p AND names differ          (MP-564)
--   placeholder_key := NOT ident_ok AND (pair_p OR pair_c) (MP-566)
-- A row whose key is not 1:1 falls through every one of them into `ambiguous`
-- REGARDLESS OF WHY. So `ambiguous` — a word that names row-pairing multiplicity —
-- was also the bucket where MP-564's and MP-566's blind spots pooled. Both of those
-- waves shipped a fix that only ever fires in the 1:1 case.
--
-- Lossless decomposition of the 305, measured live before shipping:
--   293  pairing ambiguity   real policy number, and a book row on that key names
--                            this deal's client — only row multiplicity blocks 1:1
--     8  placeholder, name-matched   placeholder policy number, one client on the key:
--                            this is exactly what MP-566's placeholder_key describes,
--                            uncounted only because the pair is not 1:1
--     3  placeholder COLLISION      policy `12345`, shared by 8 deals and 8 book rows
--                            naming 8 unrelated customers
--     1  identity COLLISION        AMW6037842 — a REAL policy number owned by Jaime
--                            Aros in BOTH tables at $736.44, with a second deal on the
--                            same number for Willie Carswell at $1,800.00
--   3 + 1 + 8 + 293 = 305, asserted by parts_reconcile below.
--
-- REFUSED A HEADLINE I HAD ALREADY DRAFTED. Grouping the ambiguous rows by policy key
-- and comparing min(deal_ap) to min(book_ap) said 1 key had a "determinate premium
-- disagreement": $1,800.00 vs $736.44 on AMW6037842. The arithmetic is correct and the
-- claim is false — those two rows are DIFFERENT PEOPLE. Reporting it as a booking error
-- would have told Sam to correct a premium in the book commissions are computed from,
-- on evidence that two unrelated customers hold different policies. That is precisely
-- the fault MP-564 shipped a fix for, reproduced one wave later in the bucket that
-- wave's fix cannot see.
--
-- REFUSED THE LOUD VERSION. The 4 collision rows hold $8,400.00 of annual premium and
-- NONE of it is money at risk: they are submitted deals with real premiums, and 3 of the
-- 4 are already inside MP-566's open item (1), the placeholder-policy pile a human has
-- to clear by writing real numbers. Nothing was over- or under-paid because of this, and
-- no premium anywhere is proven wrong. What was wrong is that the instrument filed two
-- known diseases under a label meaning "pairing noise" and carried on.
--
-- GRADED ON MOVEMENT, like every rung on this ladder. All 4 collisions are pre-anchor,
-- so they are WARN with their rows named, never CRITICAL. A collision on a deal posted
-- after fn_book_parity_anchor() is a new fault and escalates. The frozen set clears when
-- a human writes the right policy number, never by elapsed time.
--
-- CORRECTS A SHIPPED NUMBER. MP-566 reported 50 placeholder-keyed rows. Counting the
-- rows its 1:1 gate could not reach, the placeholder population is 61 (50 + 8 + 3).
-- The 50 is preserved unchanged in placeholder_keyed_rows — it is the count of
-- placeholder pairs that are 1:1 and still means exactly that — and the reachable
-- remainder is published beside it rather than rewritten into it.

-- ---------------------------------------------------------------------------
-- MP-567 PART 2: a control byte on a JSON boundary — hazard PROVEN, cause UNRESOLVED,
-- and the confident story I had already written REFUSED.
--
-- WHAT WAS OBSERVED, and it is recorded rather than reconstructed. Running apex-doctor's
-- OWN query path (not the view, the CHECK) against live prod, the response failed
-- `jq -e '.rows[0].verdict'` with "control characters from U+0000 through U+001F must be
-- escaped at line 1, column 551". Column 551 sat inside norm_merge_detail, and `grep -c`
-- found exactly ONE real tab byte in the body. The pre-MP-567 query, reconstructed
-- byte-for-byte from the backup of apex-doctor.sh, failed identically. That matters far
-- beyond one column: #79, #79b, #79c, #79d (and #79e/#79f) all live behind that single
-- `if`, so one unparseable response takes the WHOLE ladder to "could not read", which is
-- honest but blind.
--
-- WHAT I THEN WROTE AND HAD TO DELETE. The obvious story assembled itself instantly:
-- 10 agentlink_book policy numbers carry a literal TAB (\t3002130, \t3000728,
-- M003232831\t, \t3001284, M003066530\t x2, \t3000993, \t3002076\t, M003113663\t,
-- 3002178\t); MP-565 added norm_merge_detail to PUBLISH the normalization hazard and
-- interpolates lower(btrim(policy_number)), whose btrim strips spaces but not tabs —
-- exactly the evidence-eating MP-566 documented one wave later. So: the column built to
-- publish the hazard was silenced by the hazard. It is a good sentence and I could not
-- reproduce it.
--
-- THE REPRODUCTION FAILED, THREE WAYS. (a) A throwaway view serving that raw value,
-- queried three times, returned a correctly escaped \t and parsed every time.
-- (b) The full doctor-sized response with an unwrapped raw column appended: escaped,
-- parses. (c) The faithful one — the pre-MP-567 select list, its exact column ORDER,
-- with norm_merge_detail's RAW expression restored in its original position, against
-- live prod: 1,548 bytes, ZERO real tab bytes, PARSES. And of the five text columns,
-- `like '%<TAB>%'` confirms only norm_merge_detail ever held a control char at all.
--
-- SO THE CAUSE IS UNRESOLVED AND SAID SO. bot-sql escapes tabs correctly on every path
-- that can still be exercised. The failure was real, was seen twice within one minute,
-- and cannot now be provoked. Shipping "the tab broke the ladder" would have been a
-- confident causal claim behind an unreproducible observation — this chain's own
-- recurring sin wearing a new costume, and it would have retired the real question.
--
-- WHY THE WRAP SHIPS ANYWAY, and on what claim. Not as a proven fix. As defence in
-- depth for a hazard that is measured, not theoretical: 10 live rows carry a byte that
-- MUST be escaped to cross a JSON boundary, that boundary was observed once to emit one
-- raw, and the entire #79 ladder is gated on a single parse of it. The evidence is
-- PRESERVED, never stripped — deleting the control character would make the JSON valid
-- by destroying the exact byte norm_merge_detail exists to report, the mistake this
-- ladder has already recorded twice — so tabs render as <TAB> and stay legible in the
-- weekly report. It is cheap, it is lossless, and it cannot itself go wrong quietly.
-- What it is NOT is an explanation.

create or replace function public.fn_text_json_safe(p text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(
           replace(replace(replace(coalesce(p, ''),
             chr(9),  '<TAB>'),
             chr(10), '<LF>'),
             chr(13), '<CR>'),
           '[[:cntrl:]]', '<CTL>', 'g')
$$;

comment on function public.fn_text_json_safe(text) is
  'MP-567: renders control characters as visible ASCII markers so a value can cross a '
  'JSON boundary without either breaking the parse or losing the byte that mattered. '
  'Every v_book_premium_parity column that interpolates a RAW policy number must pass '
  'through this: 10 agentlink_book policy numbers carry a literal tab, and one of them '
  'silenced the entire Check #79 ladder for as long as it went unescaped.';

create or replace view public.v_book_premium_parity as
with d as (
  select d.id as deal_id, d.annual_premium as deal_ap, d.posted_at,
         d.policy_number as d_raw,
         fn_book_policy_key(d.policy_number) as pk,
         fn_book_policy_key(d.policy_number)||'~'||lower(btrim(coalesce(d.client_first_name,'')))||'|'||lower(btrim(coalesce(d.client_last_name,''))) as ck,
         btrim(lower(btrim(coalesce(d.client_first_name,'')))||' '||lower(btrim(coalesce(d.client_last_name,'')))) as dname
  from deals d
  where d.source::text = 'agent_link'::text
    and d.annual_premium is not null
    and d.policy_number is not null
    and fn_book_policy_key(d.policy_number) <> ''::text
    and not (fn_book_policy_key(d.policy_number) ~ '^0+$'::text or length(fn_book_policy_key(d.policy_number)) < 5)
), dnp as (select d.pk, count(*) as n from d group by d.pk),
   dnc as (select d.ck, count(*) as n from d group by d.ck),
b as (
  select fn_book_policy_key(agentlink_book.policy_number) as pk,
         lower(btrim(coalesce(agentlink_book.client_first_name,''))) as bfn,
         lower(btrim(coalesce(agentlink_book.client_last_name,''))) as bln,
         agentlink_book.annual_premium,
         agentlink_book.policy_number as b_raw
  from agentlink_book
  where agentlink_book.policy_number is not null
    and fn_book_policy_key(agentlink_book.policy_number) <> ''::text
), bp as (
  select b.pk, count(*) as n, min(b.annual_premium) as mn,
         min(btrim(b.bfn||' '||b.bln)) as bname, min(b.b_raw) as b_raw
  from b group by b.pk
), bc as (
  select b.pk||'~'||b.bfn||'|'||b.bln as ck, count(*) as n,
         min(b.annual_premium) as mn, min(b.b_raw) as b_raw
  from b group by b.pk||'~'||b.bfn||'|'||b.bln
),
-- Distinct client names the BOOK carries on each policy key, and whether this deal's
-- own client is one of them. Both are computed WITHOUT requiring a 1:1 pairing, which
-- is the whole point: they are the only evidence available on the rows every other
-- state in this view is structurally unable to look at.
bnk as (select b.pk, count(distinct btrim(b.bfn||' '||b.bln)) as n_names from b group by b.pk),
bnm as (select distinct b.pk, btrim(b.bfn||' '||b.bln) as nm from b),
mg as (
  select z.tbl, z.nk, count(distinct z.rawk) as k, string_agg(distinct z.rawk, ' || '::text) as raws
  from (
    select 'deals'::text as tbl, fn_book_policy_key(deals.policy_number) as nk,
           lower(btrim(deals.policy_number)) as rawk
    from deals where deals.source::text='agent_link'::text and deals.policy_number is not null
    union all
    select 'agentlink_book'::text, fn_book_policy_key(agentlink_book.policy_number),
           lower(btrim(agentlink_book.policy_number))
    from agentlink_book where agentlink_book.policy_number is not null
  ) z
  where z.nk <> ''::text
  group by z.tbl, z.nk
  having count(distinct z.rawk) > 1
),
j as (
  select d.deal_id, d.deal_ap, d.posted_at, d.d_raw, d.pk, d.ck, d.dname,
         bp.n as bpn, bp.mn as bpm, bp.bname, bp.b_raw as bp_raw, dnp.n as dpn,
         bc.n as bcn, bc.mn as bcm, bc.b_raw as bc_raw, dnc.n as dcn,
         coalesce(bnk.n_names, 0) as book_names_on_key,
         exists (select 1 from bnm where bnm.pk = d.pk and bnm.nm = d.dname) as name_corrob
  from d
    join dnp on dnp.pk = d.pk
    join dnc on dnc.ck = d.ck
    left join bp on bp.pk = d.pk
    left join bc on bc.ck = d.ck
    left join bnk on bnk.pk = d.pk
),
v as (select j.*, (j.bpn is not null and j.bpn=1 and j.dpn=1) as pair_p,
                 (j.bcn is not null and j.bcn=1 and j.dcn=1) as pair_c from j),
w as (select v.*, case when v.pair_p then v.bp_raw when v.pair_c then v.bc_raw else null::text end as matched_b_raw from v),
x as (select w.*, (fn_book_policy_identity_ok(w.d_raw) and fn_book_policy_identity_ok(coalesce(w.matched_b_raw, w.d_raw))) as ident_ok from w),
y as (select x.*, (not x.ident_ok and (x.pair_p or x.pair_c)) as placeholder_key from x),
z as (
  select y.*,
    (y.pair_p and y.ident_ok and y.dname <> ''::text and coalesce(y.bname,''::text) <> ''::text and y.dname = y.bname) as prov_p,
    (y.pair_c and y.ident_ok) as prov_c,
    (y.pair_p and y.ident_ok and y.dname <> ''::text and coalesce(y.bname,''::text) <> ''::text and y.dname <> y.bname) as conflict_p,
    (y.pair_p and y.ident_ok and (y.dname = ''::text or coalesce(y.bname,''::text) = ''::text)) as uncorrob_p
  from y
),
u as (
  select z.*,
    (z.prov_p or z.prov_c) as provable,
    case when z.prov_p then z.bpm when z.prov_c then z.bcm else null::numeric end as book_ap,
    case when z.placeholder_key and z.pair_p then z.bpm when z.placeholder_key and z.pair_c then z.bcm else null::numeric end as ph_book_ap,
    case when z.prov_p then 'policy'::text when z.prov_c then 'policy+client'::text else null::text end as key_used,
    (z.bpn is not null or z.bcn is not null) as seen_in_book,
    (z.conflict_p and not z.prov_c) as identity_conflict,
    (z.uncorrob_p and not z.prov_c) as uncorroborated
  from z
),
-- The decomposition. `amb` is byte-for-byte the population the shipped
-- ambiguous_rows counted; the four flags below partition it and nothing else.
k as (
  select u.*,
    (not u.provable and not u.placeholder_key and not u.identity_conflict
       and not u.uncorroborated and u.seen_in_book) as amb,
    (not u.ident_ok and u.book_names_on_key > 1) as r_ph_collision,
    (u.ident_ok and not u.name_corrob)            as r_id_collision,
    (not u.ident_ok and u.book_names_on_key <= 1) as r_ph_namematched,
    (u.ident_ok and u.name_corrob)                as r_pair_ambig
  from u
)
select
  (select count(*) from k where k.provable)::integer as provable_rows,
  (select count(*) from k where k.provable and round(k.deal_ap::numeric,2) = round(k.book_ap,2))::integer as agree_rows,
  (select count(*) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2))::integer as disagree_rows,
  (select coalesce(sum(k.deal_ap),0::numeric) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2))::numeric(14,2) as disagree_deals_ap,
  (select coalesce(sum(k.book_ap),0::numeric) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2))::numeric(14,2) as disagree_book_ap,
  (select coalesce(max(abs(k.deal_ap - k.book_ap)),0::numeric) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2))::numeric(14,2) as worst_gap,
  (select count(*) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2) and k.posted_at > fn_book_parity_anchor())::integer as disagree_rows_since_anchor,
  (select count(*) from k where k.amb)::integer as ambiguous_rows,
  (select count(*) from k where not k.provable and not k.placeholder_key and not k.seen_in_book)::integer as unmatched_rows,
  (select string_agg(k.pk, ', '::text order by k.pk) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2)) as disagree_policies,
  fn_text_json_safe(case
    when (select count(*) from k where k.provable) = 0
      then '⚪ UNPROVEN — no provably 1:1 deal/book pair to compare. This is never an all-clear; it means the instrument could not look.'::text
    when (select count(*) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2) and k.posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW DISAGREEMENT — '||(select count(*) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2) and k.posted_at > fn_book_parity_anchor())::text
           ||' deal(s) posted since parity was verified carry a different annual premium than agentlink_book, the book commissions are computed from. Policies: '
           ||coalesce((select string_agg(k.pk, ', '::text order by k.pk) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2) and k.posted_at > fn_book_parity_anchor()),'(none)'::text)
           ||'. The import lane is writing wrong dollars NOW.'
    when (select count(*) from k where k.identity_conflict and k.posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW IDENTITY CONFLICT — '||(select count(*) from k where k.identity_conflict and k.posted_at > fn_book_parity_anchor())::text
           ||' policy number(s) written since the anchor name a DIFFERENT customer in deals than in agentlink_book: '
           ||coalesce((select string_agg(k.pk||' (deals: '||k.dname||' vs book: '||k.bname||')', '; '::text order by k.pk) from k where k.identity_conflict and k.posted_at > fn_book_parity_anchor()),'(none)'::text)
           ||'. Do not compare their premiums — reconcile which customer owns the number first.'
    when (select count(*) from k where k.r_id_collision and k.amb and k.posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW IDENTITY COLLISION — '||(select count(*) from k where k.r_id_collision and k.amb and k.posted_at > fn_book_parity_anchor())::text
           ||' deal(s) posted since the anchor carry a REAL policy number that agentlink_book records against a different customer entirely: '
           ||coalesce((select string_agg(k.pk||' (deal: '||k.dname||' $'||round(k.deal_ap::numeric,2)::text||'; book names that policy to '||coalesce(k.bname,'?')||')', '; '::text order by k.pk) from k where k.r_id_collision and k.amb and k.posted_at > fn_book_parity_anchor()),'(none)'::text)
           ||'. Their premiums are NOT compared — reconcile which customer owns the number first.'
    when (select count(*) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2)) > 0
      then '🟡 KNOWN — '||(select count(*) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2))::text
           ||' pre-anchor deal(s) disagree with the book: '
           ||coalesce((select string_agg(k.pk, ', '::text order by k.pk) from k where k.provable and round(k.deal_ap::numeric,2) <> round(k.book_ap,2)),''::text)
           ||'. Static, not growing. Clears when the premium is corrected on one side, not by elapsed time. '
           ||(select count(*) from k where k.provable and round(k.deal_ap::numeric,2) = round(k.book_ap,2))::text||' of '
           ||(select count(*) from k where k.provable)::text||' provable pairs agree to the cent.'
    when (select count(*) from k where k.identity_conflict) > 0
      then '🟡 IDENTITY CONFLICT — '||(select count(*) from k where k.identity_conflict)::text
           ||' pre-anchor policy number(s) name a different customer in deals than in agentlink_book: '
           ||coalesce((select string_agg(k.pk||' (deals: '||k.dname||' vs book: '||k.bname||')', '; '::text order by k.pk) from k where k.identity_conflict),''::text)
           ||'. Their premiums are NOT compared and neither side is called wrong — the two rows are different people. Clears when one system is corrected to name the right owner. '
           ||(select count(*) from k where k.provable and round(k.deal_ap::numeric,2) = round(k.book_ap,2))::text||' of '
           ||(select count(*) from k where k.provable)::text||' corroborated pairs agree to the cent.'
    when (select count(*) from k where k.placeholder_key and round(k.deal_ap::numeric,2) <> round(k.ph_book_ap,2)) > 0
      then '🟡 PLACEHOLDER DISAGREEMENT — '||(select count(*) from k where k.placeholder_key and round(k.deal_ap::numeric,2) <> round(k.ph_book_ap,2))::text
           ||' deal/book pair(s) matched only by client name disagree on premium, and neither side carries a real policy number: '
           ||coalesce((select string_agg(k.dname||' ['||btrim(k.d_raw)||'] deals $'||round(k.deal_ap::numeric,2)::text||' vs book $'||round(k.ph_book_ap,2)::text, '; '::text order by k.dname) from k where k.placeholder_key and round(k.deal_ap::numeric,2) <> round(k.ph_book_ap,2)),''::text)
           ||'. Do NOT correct a premium on this evidence — without a policy number there is no way to tell a wrong dollar from two different policies. Write the real policy number first.'
    when (select count(*) from k where k.amb and (k.r_id_collision or k.r_ph_collision)) > 0
      then '🟡 COLLISION IN THE UNPROVABLE BUCKET — '
           ||(select count(*) from k where k.amb and k.r_id_collision)::text||' deal(s) carry a real policy number the book records against a different customer, and '
           ||(select count(*) from k where k.amb and k.r_ph_collision)::text||' carry a placeholder number shared by unrelated customers. All pre-anchor. These are NOT pairing noise: they were filed as ambiguous only because every classified state in this view requires a 1:1 pairing. Premiums are deliberately not compared. Clears when a human writes the right policy number, not by elapsed time. '
           ||(select count(*) from k where k.provable and round(k.deal_ap::numeric,2) = round(k.book_ap,2))::text||' of '
           ||(select count(*) from k where k.provable)::text||' corroborated pairs agree to the cent.'
    else '🟢 OK — all '||(select count(*) from k where k.provable)::text
         ||' corroborated 1:1 deal/book pairs agree to the cent. '
         ||(select count(*) from k where k.placeholder_key)::text
         ||' further pair(s) agree but are matched by client name over a placeholder policy number ('
         ||coalesce((select string_agg(distinct btrim(k.d_raw), ', '::text) from k where k.placeholder_key and btrim(k.d_raw) in (
              select btrim(k2.d_raw) from k k2 where k2.placeholder_key group by btrim(k2.d_raw) order by count(*) desc limit 4)),''::text)
         ||' …) — counted separately, never as policy parity. '
         ||(select count(*) from k where k.amb and k.r_pair_ambig)::text||' row(s) are unprovable on PAIRING alone (real policy number, client corroborated on both sides, multiple rows share the key), '
         ||(select count(*) from k where k.amb and k.r_ph_namematched)::text||' more sit on a placeholder number, and '
         ||(select count(*) from k where not k.provable and not k.placeholder_key and not k.seen_in_book)::text
         ||' unmatched row(s) are absent from the book entirely. None are counted as agreement.'
  end) as verdict,
  now() as as_of,
  (select count(*) from k where k.key_used = 'policy'::text)::integer as provable_by_policy,
  (select count(*) from k where k.key_used = 'policy+client'::text)::integer as provable_by_client_key,
  (select count(*) from k where k.identity_conflict)::integer as identity_conflict_rows,
  (select count(*) from k where k.identity_conflict and k.posted_at > fn_book_parity_anchor())::integer as identity_conflict_rows_since_anchor,
  fn_text_json_safe((select string_agg(k.pk||' (deals: '||k.dname||' $'||round(k.deal_ap::numeric,2)::text||' vs book: '||k.bname||' $'||round(k.bpm,2)::text||')', '; '::text order by k.pk) from k where k.identity_conflict)) as identity_conflict_detail,
  (select count(*) from k where k.uncorroborated)::integer as uncorroborated_rows,
  (select count(*) from k)::integer as total_rows,
  (select count(*) from mg)::integer as norm_merge_groups,
  fn_text_json_safe((select string_agg(mg.tbl||'.'||mg.nk||' <- {'||mg.raws||'}', '; '::text order by mg.tbl, mg.nk) from mg)) as norm_merge_detail,
  (select count(*) from k where k.placeholder_key)::integer as placeholder_keyed_rows,
  (select count(*) from k where k.placeholder_key and round(k.deal_ap::numeric,2) = round(k.ph_book_ap,2))::integer as placeholder_keyed_agree,
  (select count(*) from k where k.placeholder_key and round(k.deal_ap::numeric,2) <> round(k.ph_book_ap,2))::integer as placeholder_keyed_disagree,
  (select coalesce(sum(k.deal_ap),0::numeric) from k where k.placeholder_key)::numeric(14,2) as placeholder_keyed_ap,
  fn_text_json_safe((select string_agg(v2.pn||' x'||v2.n::text, ', '::text order by v2.n desc, v2.pn) from (
     select btrim(k.d_raw) as pn, count(*) as n from k where k.placeholder_key group by btrim(k.d_raw)) v2)) as placeholder_keyed_detail,
  -- MP-567: the ambiguous bucket, decomposed by WHY the row fell through.
  (select count(*) from k where k.amb and k.r_pair_ambig)::integer      as amb_pairing_rows,
  (select count(*) from k where k.amb and k.r_ph_namematched)::integer  as amb_placeholder_namematched_rows,
  (select count(*) from k where k.amb and k.r_ph_collision)::integer    as amb_placeholder_collision_rows,
  (select count(*) from k where k.amb and k.r_id_collision)::integer    as amb_identity_collision_rows,
  (select count(*) from k where k.amb and k.r_ph_collision and k.posted_at > fn_book_parity_anchor())::integer as amb_placeholder_collision_since_anchor,
  (select count(*) from k where k.amb and k.r_id_collision and k.posted_at > fn_book_parity_anchor())::integer as amb_identity_collision_since_anchor,
  (select coalesce(sum(k.deal_ap),0::numeric) from k where k.amb and (k.r_ph_collision or k.r_id_collision))::numeric(14,2) as amb_collision_ap,
  fn_text_json_safe((select string_agg(k.pk||' ['||btrim(k.d_raw)||'] deal names '||k.dname||' $'||round(k.deal_ap::numeric,2)::text
        ||'; book names '||coalesce((select string_agg(distinct bnm2.nm, ' / ') from bnm bnm2 where bnm2.pk = k.pk),'(none)')
        ||' on that policy', '; '::text order by k.posted_at)
     from k where k.amb and (k.r_ph_collision or k.r_id_collision))) as amb_collision_detail,
  -- Losslessness. The four reasons must partition `amb` exactly. If this ever goes
  -- false a row has silently left the ladder, which is an arithmetic failure rather
  -- than a smaller total nobody holds a baseline for (MP-564's Check #79c pattern).
  ((select count(*) from k where k.amb and k.r_pair_ambig)
   + (select count(*) from k where k.amb and k.r_ph_namematched)
   + (select count(*) from k where k.amb and k.r_ph_collision)
   + (select count(*) from k where k.amb and k.r_id_collision)
   = (select count(*) from k where k.amb)) as amb_parts_reconcile;
