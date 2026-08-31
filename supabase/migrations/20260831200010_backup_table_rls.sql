-- MP-337c: deny-by-default on the two bookkeeping tables this work created.
--
-- agents_phantom_backup was created with LIKE public.agents INCLUDING ALL,
-- which copies indexes, defaults and constraints but NOT row-level security —
-- so it held a copy of an agent row with RLS off. It was not reachable:
-- verified no grant exists to anon or authenticated, and PostgREST cannot read
-- a table it has no grant on. But "safe because nobody granted it yet" is an
-- accident, not a property, and a future blanket
-- `grant select on all tables in schema public` would silently expose it.
--
-- RLS enabled with NO policy: service_role and SECURITY DEFINER owners still
-- read it, every authenticated caller gets zero rows. Nothing in the app reads
-- either table, so there is no policy to write.

begin;

alter table public.agents_phantom_backup enable row level security;
alter table public.mat_refresh_heartbeat enable row level security;

revoke all on public.agents_phantom_backup from anon, authenticated;
revoke all on public.mat_refresh_heartbeat from anon, authenticated;

comment on table public.agents_phantom_backup is
  'MP-336: pre-image of agent rows removed as phantoms. Holds agent PII, so it '
  'is RLS-on with no policy and no grant — readable only by service_role.';

commit;
