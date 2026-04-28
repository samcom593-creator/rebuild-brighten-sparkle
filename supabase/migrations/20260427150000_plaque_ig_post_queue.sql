-- Plaque → agent personal IG post queue.
-- Worker (Mac launchd or edge cron) picks up status='pending' rows, posts
-- via the agent's IG creds, then flips status='posted'/'failed'.

create table if not exists public.plaque_ig_post_queue (
  id              uuid primary key default gen_random_uuid(),
  plaque_id       uuid not null references public.plaque_awards(id) on delete cascade,
  agent_id        uuid not null,
  ig_handle       text not null,
  image_url       text not null,
  caption         text,
  status          text not null default 'pending'
                    check (status in ('pending','posting','posted','failed','skipped')),
  attempts        int  not null default 0,
  posted_post_id  text,
  error_message   text,
  enqueued_at     timestamptz not null default now(),
  posted_at       timestamptz,
  unique (plaque_id, agent_id)
);

create index if not exists plaque_ig_queue_status_enq_idx
  on public.plaque_ig_post_queue (status, enqueued_at);

alter table public.plaque_ig_post_queue enable row level security;

-- Service role only (worker runs with service key; users never touch this directly)
drop policy if exists "service role full access" on public.plaque_ig_post_queue;
create policy "service role full access" on public.plaque_ig_post_queue
  for all to service_role using (true) with check (true);

-- Admins can read for visibility
drop policy if exists "admins can read" on public.plaque_ig_post_queue;
create policy "admins can read" on public.plaque_ig_post_queue
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.user_id = auth.uid()
                   and (p.role = 'admin' or p.role = 'owner')));
