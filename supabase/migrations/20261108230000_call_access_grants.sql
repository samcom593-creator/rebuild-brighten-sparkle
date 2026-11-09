-- MP-CALL-ACCESS (2026-11-08): "manage those access to your agents' calls — such as OB having access."
-- can_view_sold_calls() was admin OR one hardcoded UUID (Aisha), compiled into the function
-- body, so every grant change was a code deploy. It now reads a grants table admins manage
-- from the Sold Calls page. Same SECURITY DEFINER shape; every RLS policy that calls it
-- (readymode_call_audio, readymode_agent_coaching, call-training tables, lead_bundle_events,
-- the sold-call views) picks the change up with zero policy churn. Seeded with the status quo
-- (Aisha Kebbeh, Sam's 2026-05 directive) plus Obiajulu Ifediora (Sam, 2026-11-08).
-- Sold-call packets carry SSN/bank data: a grant here is a sensitive-data grant, which is
-- exactly why it belongs in a table Sam can revoke from a page instead of a deploy.

create table if not exists public.call_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  granted_by uuid,
  created_at timestamptz not null default now()
);

alter table public.call_access_grants enable row level security;

drop policy if exists call_access_grants_admin_all on public.call_access_grants;
create policy call_access_grants_admin_all on public.call_access_grants
  for all to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

drop policy if exists call_access_grants_self_read on public.call_access_grants;
create policy call_access_grants_self_read on public.call_access_grants
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.can_view_sold_calls()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select public.has_role(auth.uid(), 'admin'::public.app_role)
      or exists (select 1 from public.call_access_grants g where g.user_id = auth.uid());
$$;

grant execute on function public.can_view_sold_calls() to authenticated;

insert into public.call_access_grants (user_id, note, granted_by) values
  ('66bc4464-f10b-4ecf-8e8b-144486f18a44', 'Aisha Kebbeh — original sold-calls grant (Sam directive, 2026-05)', '71826bba-5577-4810-a226-1f6f2ad5288a'),
  ('80010a1e-f368-4d01-b8de-f4af5b601a66', 'Obiajulu Ifediora — manager access to agent calls (Sam, 2026-11-08)', '71826bba-5577-4810-a226-1f6f2ad5288a')
on conflict (user_id) do nothing;
