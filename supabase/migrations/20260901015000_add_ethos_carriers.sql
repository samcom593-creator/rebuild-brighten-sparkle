begin;

-- MP-359: Ethos deals could not be posted because the carrier did not exist.
--
-- Reported: "the post deal function, particularly for Ethos, is not working."
--
-- CAUSE, measured. SubmitDealDialog:399 hard-requires a carrier —
-- "Carrier, product, and application or policy number are required" — and the
-- carrier control is a Select bound to public.carriers. That table holds 18
-- rows and NONE of them is Ethos, TruStage or Prosperity. An agent writing
-- through Ethos therefore had no selectable carrier and was blocked at
-- validation before anything reached the server. Nothing was broken in the
-- submit path; the option simply was not there.
--
-- Prosperity is included because it is the carrier on all 1,468 rows of
-- ethos_book_policies — Ethos is the platform, Prosperity is what the policies
-- are actually written with, and an agent will look for either.
--
-- Product is NOT a blocker: that field is a free-text input with a datalist of
-- suggestions (SubmitDealDialog:755), so a carrier with no written history
-- still accepts a typed product. Worth stating because v_carrier_products
-- derives its options from deals ALREADY written, which would otherwise make
-- every brand-new carrier permanently unpostable.
insert into public.carriers (name, is_active, active)
select v.name, true, true
from (values ('Ethos'), ('Prosperity'), ('TruStage')) as v(name)
where not exists (
  select 1 from public.carriers c where lower(btrim(c.name)) = lower(v.name)
);

commit;
