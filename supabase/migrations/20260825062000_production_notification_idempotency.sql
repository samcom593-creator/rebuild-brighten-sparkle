create table if not exists public.production_submission_notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  production_date date not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'unknown_outcome', 'failed')),
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (agent_id, production_date)
);
alter table public.production_submission_notifications enable row level security;
drop policy if exists "Staff can read production notification receipts" on public.production_submission_notifications;
create policy "Staff can read production notification receipts"
  on public.production_submission_notifications for select to authenticated
  using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role::text in ('admin', 'manager')));
create index if not exists production_submission_notifications_date_idx
  on public.production_submission_notifications (production_date desc, status);
