-- Launch Board content workflow: a saved brief per project, one project per idea, and dismissals that can be undone (2026-10-09)
--
-- Sam: pick what to film next from three strong, distinct choices; choose one and have it saved as ONE persistent
-- project; dismiss the ones he does not want (with an optional reason) and bring them back later; remake a measured
-- winner without creating a duplicate.
--
-- What the existing table could not hold (measured 2026-10-09): a premise, the audience payoff, an effort estimate,
-- where it is filmed, why it was suggested, and a link from a remake to the post it remakes. The only free-text
-- columns (hook, caption, record_script, edit_prompt) each have a job already.
--
-- WHAT THIS DOES (additive; no existing row is rewritten; nothing is deleted):
--   1. content_cards.brief  jsonb, default '{}'. The saved brief: idea_key, premise, payoff, reason, effort_minutes,
--      topic, locations, platforms, source ('bank' | 'insights' | 'own' | 'remake'), and for a remake the post it
--      came from, the variation and the hypothesis. A size cap keeps it a brief, not a dumping ground.
--   2. A unique index on brief->>'idea_key' for LIVE (not archived) cards. Two taps on "Film this", two browser tabs
--      or two devices cannot create two projects for one idea: the second insert fails and the page re-reads the
--      first. An archived card does not block a new one; the page restores the archived card instead.
--   3. content_idea_dismissals: one row per dismissed suggestion with an optional reason. A dismissed suggestion is
--      not a project, so it is not a card. Deleting the row is the Undo, and it is the only thing Undo ever deletes.
--      Same access rule as content_cards: admins and invited content users.
--
-- Existing cards have an empty brief and are untouched. The page still matches an old card to an idea by exact title
-- when there is no idea_key, so an idea that already became a card is never offered or created twice.

begin;

alter table public.content_cards add column if not exists brief jsonb not null default '{}'::jsonb;

alter table public.content_cards drop constraint if exists content_cards_brief_is_object;
alter table public.content_cards add constraint content_cards_brief_is_object
  check (jsonb_typeof(brief) = 'object' and pg_column_size(brief) <= 16384);

create unique index if not exists content_cards_idea_key_live_uniq
  on public.content_cards ((brief ->> 'idea_key'))
  where brief ? 'idea_key' and archived_at is null;

create table if not exists public.content_idea_dismissals (
  idea_key text primary key check (char_length(idea_key) between 1 and 200),
  title text check (title is null or char_length(title) <= 300),
  reason text check (reason is null or char_length(reason) <= 300),
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid default auth.uid()
);

alter table public.content_idea_dismissals enable row level security;

drop policy if exists content_idea_dismissals_admin_all on public.content_idea_dismissals;
create policy content_idea_dismissals_admin_all on public.content_idea_dismissals for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists content_idea_dismissals_invited_all on public.content_idea_dismissals;
create policy content_idea_dismissals_invited_all on public.content_idea_dismissals for all to authenticated
  using (public.content_can_access())
  with check (public.content_can_access());

revoke all on table public.content_idea_dismissals from public, anon;
grant select, insert, update, delete on table public.content_idea_dismissals to authenticated;
grant all on table public.content_idea_dismissals to service_role;

commit;
