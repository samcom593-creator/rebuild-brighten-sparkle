-- MP-309 Money Inbox: Sam-only ranked iMessage threads + approve-to-send queue. Daemon writes with service role.
create table if not exists public.money_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null unique,
  chat_identifier text,
  handle text,
  display_name text,
  is_group boolean not null default false,
  category text,
  money_score numeric not null default 0,
  money_reasons text[] not null default '{}',
  rank int,
  awaiting_reply boolean not null default false,
  last_inbound_at timestamptz,
  last_inbound_text text,
  last_outbound_at timestamptz,
  excerpt jsonb not null default '[]'::jsonb,
  draft_reply text,
  draft_engine text,
  final_reply text,
  status text not null default 'pending' check (status in ('pending','approved','sending','sent','failed','skipped')),
  approved_at timestamptz,
  sent_at timestamptz,
  send_receipt text,
  send_error text,
  muted boolean not null default false,
  in_scan boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists money_inbox_threads_rank_idx on public.money_inbox_threads (in_scan, rank);
create index if not exists money_inbox_threads_status_idx on public.money_inbox_threads (status);
create or replace function public.fn_money_inbox_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_money_inbox_touch on public.money_inbox_threads;
create trigger trg_money_inbox_touch before update on public.money_inbox_threads for each row execute function public.fn_money_inbox_touch();
alter table public.money_inbox_threads enable row level security;
revoke all on public.money_inbox_threads from anon;
revoke all on public.money_inbox_threads from authenticated;
grant select, update on public.money_inbox_threads to authenticated;
drop policy if exists money_inbox_sam_select on public.money_inbox_threads;
drop policy if exists money_inbox_sam_update on public.money_inbox_threads;
-- Only Sam's login can read or act. The sending daemon uses the service role (bypasses RLS).
create policy money_inbox_sam_select on public.money_inbox_threads for select to authenticated
  using (auth.uid() = '71826bba-5577-4810-a226-1f6f2ad5288a'::uuid);
create policy money_inbox_sam_update on public.money_inbox_threads for update to authenticated
  using (auth.uid() = '71826bba-5577-4810-a226-1f6f2ad5288a'::uuid)
  with check (auth.uid() = '71826bba-5577-4810-a226-1f6f2ad5288a'::uuid);
