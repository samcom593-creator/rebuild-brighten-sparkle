-- MP-563 (2026-09-18) — the reconciliation key, widened.
--
-- MP-562 shipped v_book_premium_parity and closed by naming its own limit:
--   "446 of 1,598 deals cannot be reconciled per-row at all because their
--    policy number is ambiguous (54 keys shared by different clients) --
--    reconciliation by policy_number is structurally capped at ~70% coverage
--    and no better key exists between the tables (external_deal_id and
--    deal_key share no namespace)."
--
-- The external_deal_id/deal_key half of that is CONFIRMED: deal_key is a
-- 32-char hash, external_deal_id is a small integer, and the two sets have
-- exactly 0 rows in common under both exact and normalised comparison.
--
-- "No better key exists" is FALSE, and the sentence that states the problem
-- also names the solution. If a key is shared by DIFFERENT CLIENTS, then the
-- client disambiguates it -- and both tables already carry client_first_name
-- and client_last_name. Measured on the live ambiguous set: of the 182
-- ambiguous deal-side keys, only 51 carry more than one client; the other 131
-- (289 rows) are a single client whose policy appears more than once. Reading
-- rows back rather than trusting the count, policy 000008253920 is carried by
-- FOUR different clients at four different premiums (Anthony Bruce 1928.28,
-- Deborah Jones 2291.64, Isreal Jungerman 671.76, Janice Burton 247.80) and
-- every one of them matches agentlink_book to the cent once the client is in
-- the key. These are shared placeholder/batch numbers, not real per-policy
-- identifiers, so they were never ambiguous in the sense that matters.
--
-- THE KEY IS A LADDER, NOT A REPLACEMENT. policy_number is tried first and
-- wins whenever it is 1:1; the client-composite is consulted ONLY where the
-- policy key is ambiguous. This is load-bearing in one direction: it means the
-- new leg can only ADD pairs, never retire one the old key had already proven,
-- so a disagreement cannot be laundered into silence by widening the key. The
-- one known disagreement (7gg62152) survives the widening, verified.
--
-- Coverage 1,112 -> 1,254 of 1,598 (69.6% -> 78.5%); unprovable 486 -> 344.
-- 142 rows added, and ZERO of them disagree -- so this recovers no money and
-- fixes no outage. What it fixes is a sentence: the blind spot was being
-- described as structural, which is a reason for the next wave to stop looking.
--
-- A GUARD WAS WRITTEN FOR THIS AND THEN DELETED, which is the part worth
-- keeping. Adding a second key creates a hazard the single-key view could not
-- have -- two keys disagreeing about the same deal -- so a key_conflict_rows
-- counter was added to grade it. Writing its positive control is what killed
-- it: when bp.n = 1, exactly one book row carries that policy, and the
-- composite's candidates are a SUBSET of that row, so bc.n = 1 can only be the
-- same row and the two premiums are necessarily identical. The counter can
-- never be anything but 0. Proven rather than argued: inserting a deliberately
-- conflicting book row at 9,999.99 leaves it at 0, because the duplicate makes
-- BOTH rungs ambiguous at once. A permanently-zero counter published beside
-- real numbers reads as a hazard being watched when nothing is watching, which
-- is the disease this file's own ancestors were written to cure -- so it is
-- gone, and the fact it was trying to state lives here instead: the ladder's
-- ORDER IS INERT BY CONSTRUCTION, not by luck. Corroborated empirically -- a
-- composite-first counterfactual returns the identical 1,254 / 1 / 7gg62152.
--
-- STILL UNPROVABLE, and deliberately still reported as such: 344 rows where
-- policy AND client are both ambiguous, or where the pair exists on only one
-- side. Not verified, not laundered into agreement.

create or replace view public.v_book_premium_parity as
with d as (
  select d.id as deal_id,
         d.annual_premium as deal_ap,
         d.posted_at,
         lower(btrim(d.policy_number)) as pk,
         lower(btrim(d.policy_number)) || '~' ||
           lower(btrim(coalesce(d.client_first_name,''))) || '|' ||
           lower(btrim(coalesce(d.client_last_name,''))) as ck
  from deals d
  where d.source::text = 'agent_link'::text
    and d.annual_premium is not null
    and d.policy_number is not null
    and btrim(d.policy_number) <> ''
    and not (btrim(d.policy_number) ~ '^0+$' or length(btrim(d.policy_number)) < 5)
),
dnp as (select pk, count(*) as n from d group by pk),
dnc as (select ck, count(*) as n from d group by ck),
bp as (
  select lower(btrim(policy_number)) as pk, count(*) as n, min(annual_premium) as mn
  from agentlink_book
  where policy_number is not null and btrim(policy_number) <> ''
  group by 1
),
bc as (
  select lower(btrim(policy_number)) || '~' ||
           lower(btrim(coalesce(client_first_name,''))) || '|' ||
           lower(btrim(coalesce(client_last_name,''))) as ck,
         count(*) as n, min(annual_premium) as mn
  from agentlink_book
  where policy_number is not null and btrim(policy_number) <> ''
  group by 1
),
j as (
  select d.deal_id, d.deal_ap, d.posted_at, d.pk, d.ck,
         bp.n as bpn, bp.mn as bpm, dnp.n as dpn,
         bc.n as bcn, bc.mn as bcm, dnc.n as dcn
  from d
  join dnp on dnp.pk = d.pk
  join dnc on dnc.ck = d.ck
  left join bp on bp.pk = d.pk
  left join bc on bc.ck = d.ck
),
v as (
  select *,
         (bpn is not null and bpn = 1 and dpn = 1) as prov_p,
         (bcn is not null and bcn = 1 and dcn = 1) as prov_c
  from j
),
u as (
  select *,
         -- LADDER: policy first, client-composite only where policy is ambiguous.
         case when prov_p then bpm when prov_c then bcm end as book_ap,
         (prov_p or prov_c) as provable,
         case when prov_p then 'policy'
              when prov_c then 'policy+client'
         end as key_used,
         -- a row is only "ambiguous" if SOME book row carries its key but no
         -- rung of the ladder resolves it 1:1; "unmatched" means neither rung
         -- found the pair on the book side at all.
         (bpn is not null or bcn is not null) as seen_in_book
  from v
)
select
  (select count(*) from u where provable)::int as provable_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::int as agree_rows,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::int as disagree_rows,
  (select coalesce(sum(deal_ap),0)::numeric(14,2) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_deals_ap,
  (select coalesce(sum(book_ap),0)::numeric(14,2) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_book_ap,
  (select coalesce(max(abs(deal_ap - book_ap)),0)::numeric(14,2) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as worst_gap,
  (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::int as disagree_rows_since_anchor,
  (select count(*) from u where not provable and seen_in_book)::int as ambiguous_rows,
  (select count(*) from u where not provable and not seen_in_book)::int as unmatched_rows,
  (select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) as disagree_policies,
  case
    when (select count(*) from u where provable) = 0
      then '⚪ UNPROVEN — no provably 1:1 deal/book pair to compare. This is never an all-clear; it means the instrument could not look.'
    when (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor()) > 0
      then '🔴 NEW DISAGREEMENT — ' ||
           (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor())::text ||
           ' deal(s) posted since parity was verified carry a different annual premium than agentlink_book, the book commissions are computed from. Policies: ' ||
           coalesce((select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2) and posted_at > fn_book_parity_anchor()),'(none)') ||
           '. The import lane is writing wrong dollars NOW.'
    when (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)) > 0
      then '🟡 KNOWN — ' ||
           (select count(*) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2))::text ||
           ' pre-anchor deal(s) disagree with the book: ' ||
           coalesce((select string_agg(pk, ', ' order by pk) from u where provable and round(deal_ap::numeric,2) <> round(book_ap,2)),'') ||
           '. Static, not growing. Clears when the premium is corrected on one side, not by elapsed time. ' ||
           (select count(*) from u where provable and round(deal_ap::numeric,2) = round(book_ap,2))::text || ' of ' ||
           (select count(*) from u where provable)::text || ' provable pairs agree to the cent.'
    else '🟢 OK — all ' || (select count(*) from u where provable)::text ||
         ' provably 1:1 deal/book pairs agree to the cent. ' ||
         (select count(*) from u where not provable and seen_in_book)::text || ' ambiguous + ' ||
         (select count(*) from u where not provable and not seen_in_book)::text ||
         ' unmatched row(s) are reported unprovable, not counted as agreement.'
  end as verdict,
  now() as as_of,
  -- MP-563: appended, not inserted -- CREATE OR REPLACE VIEW refuses to rename
  -- or reorder an existing column, so the ladder's per-rung coverage lands at
  -- the end. Attributable coverage means a silently-dropped leg shows up as a
  -- number, not merely as a smaller total nobody has a baseline for.
  (select count(*) from u where key_used = 'policy')::int as provable_by_policy,
  (select count(*) from u where key_used = 'policy+client')::int as provable_by_client_key;
