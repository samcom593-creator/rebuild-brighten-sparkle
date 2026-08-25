-- Canonical comp assignment for hiring and account control.
-- 50–100 is immediately approved. Above 100 remains pending until Sam
-- explicitly approves it from the agent profile.

alter table public.agents
  add column if not exists comp_percentage numeric not null default 60,
  add column if not exists comp_approval_status text not null default 'approved',
  add column if not exists comp_approved_at timestamptz,
  add column if not exists comp_approved_by uuid references auth.users(id) on delete set null;

alter table public.agents drop constraint if exists agents_comp_percentage_range;
alter table public.agents add constraint agents_comp_percentage_range
  check (comp_percentage between 50 and 200);

alter table public.agents drop constraint if exists agents_comp_approval_status_check;
alter table public.agents add constraint agents_comp_approval_status_check
  check (comp_approval_status in ('approved', 'pending_sam', 'denied'));

update public.agents
set comp_approval_status = case when comp_percentage > 100 then 'pending_sam' else 'approved' end,
    comp_approved_at = case when comp_percentage <= 100 then coalesce(comp_approved_at, now()) else null end
where comp_approval_status is null
   or (comp_percentage <= 100 and comp_approval_status = 'pending_sam');

comment on column public.agents.comp_percentage is
  'Canonical agent comp percentage. Add Agent defaults to 60; allowed range 50–200.';
comment on column public.agents.comp_approval_status is
  'Comp above 100 must remain pending_sam until Sam explicitly approves it.';
