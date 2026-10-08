-- Reversible Launch Board cleanup. Existing RLS continues to authorize writes.
alter table public.content_cards add column if not exists archived_at timestamptz;
comment on column public.content_cards.archived_at is 'Hidden from the active Launch Board; restore by clearing this timestamp. Media is preserved.';
alter table public.content_cards add constraint content_cards_archive_only_unused_ideas
  check (archived_at is null or (status = 'idea' and coalesce(btrim(clip), '') = ''));
