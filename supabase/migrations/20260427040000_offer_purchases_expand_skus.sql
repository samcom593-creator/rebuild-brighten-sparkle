-- Expand offer_purchases SKU CHECK from 4 → 7 to admit fitness_reset,
-- kingofsales_course, work_with_sam (one-time payment products).
-- Postgres doesn't allow ALTER CONSTRAINT IF EXISTS for CHECKs, so the
-- pattern is: drop the existing CHECK, recreate with the wider set.

alter table public.offer_purchases drop constraint if exists offer_purchases_sku_check;

alter table public.offer_purchases
  add constraint offer_purchases_sku_check check (
    sku in (
      'gold','platinum','auto_dm','social_growth',
      'fitness_reset','kingofsales_course','work_with_sam'
    )
  );

comment on constraint offer_purchases_sku_check on public.offer_purchases is
  '7-SKU monetisation suite: 2 lead subs (gold/platinum), 2 social subs (auto_dm/social_growth), 3 one-time products (fitness_reset $97, kingofsales_course $497, work_with_sam $5000).';
