-- MP-CONTENT-6: one invite = the whole Launch Board (all clips, cards, week) + the Content queue. Applied via connector 2026-09-10; idempotent.
-- content_access (managed on /dashboard/content) now also opens content_cards / content_clips / content_shares through content_can_access().
drop policy if exists content_cards_invited_all on public.content_cards;
create policy content_cards_invited_all on public.content_cards for all to authenticated
  using (public.content_can_access()) with check (public.content_can_access());
drop policy if exists content_clips_invited_all on public.content_clips;
create policy content_clips_invited_all on public.content_clips for all to authenticated
  using (public.content_can_access()) with check (public.content_can_access());
drop policy if exists content_shares_invited_all on public.content_shares;
create policy content_shares_invited_all on public.content_shares for all to authenticated
  using (public.content_can_access()) with check (public.content_can_access());
