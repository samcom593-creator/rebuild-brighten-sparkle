-- Launch Board v3 (2026-09-15): Instagram retired, cards funnel to apex-financial.org/apply.
-- brand becomes the CHANNEL: YT = YouTube long-form, SH = Shorts (Repurpose.io republishes to TikTok).
-- SFD / IMS (the two Instagram handles) stay legal so historical rows keep their meaning; the UI renders them as retired.
-- Idempotent on purpose: hand-applied via bot-sql the same day, so a pipeline replay must be a no-op.
ALTER TABLE public.content_cards DROP CONSTRAINT IF EXISTS content_cards_brand_check;
ALTER TABLE public.content_cards
  ADD CONSTRAINT content_cards_brand_check CHECK (brand = ANY (ARRAY['SFD'::text, 'IMS'::text, 'YT'::text, 'SH'::text]));
