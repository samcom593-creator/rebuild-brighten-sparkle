-- Training Hub course progress (apex-resources courses rendered inside apex-financial.org)
-- Per-user lesson/quiz completion for hub courses (course_id/item_id are the
-- apex-resources content ids, e.g. r-mqv77rk9 / l-mqv72fql). Replaces the old
-- localStorage-by-typed-email progress on apex-resources.vercel.app.
create table if not exists public.hub_course_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id text not null,
  item_id text not null,
  kind text not null default 'lesson' check (kind in ('lesson','quiz')),
  score integer,
  passed boolean,
  completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hub_course_progress_user_course_item_key unique (user_id, course_id, item_id)
);

create index if not exists idx_hub_course_progress_course on public.hub_course_progress (course_id, user_id);

alter table public.hub_course_progress enable row level security;

create policy "hub_progress_select_own" on public.hub_course_progress
  for select using (auth.uid() = user_id);
create policy "hub_progress_insert_own" on public.hub_course_progress
  for insert with check (auth.uid() = user_id);
create policy "hub_progress_update_own" on public.hub_course_progress
  for update using (auth.uid() = user_id);
-- Admin cohort visibility (future admin completion views)
create policy "hub_progress_select_admin" on public.hub_course_progress
  for select using (has_role(auth.uid(), 'admin'::app_role));
