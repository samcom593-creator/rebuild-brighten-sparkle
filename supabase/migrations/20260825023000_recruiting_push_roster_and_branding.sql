-- Recruiting-push release: reversible roster cleanup + agency-scoped branding.

-- Removing an agent from the operating roster must never erase their production,
-- notes, training, or audit history. IDs are explicit so a future same-name hire
-- cannot be caught by a fuzzy name update. Wendell Funderburg is intentionally
-- absent from this list and remains active.
update public.agents
set status = 'terminated',
    is_deactivated = true,
    is_inactive = true,
    deactivation_reason = 'inactive',
    updated_at = now()
where id in (
  '94a1977a-fee5-4909-bb19-13854b98ec6f', -- Dalton Rowland
  '83773230-0b8a-4dae-815d-e45d5e37fb86', -- Dudley Bowman
  '0dfcd072-9e86-431c-9f38-4235865919fb', -- Logan Spatola
  '0a823d7e-05c9-46a7-af14-2c76fe40cc00', -- Matias Touchstone
  'f71ab73c-5026-4c72-865e-5ce3d7a7bc82', -- Matthew Anduha active record
  'b4b915bb-4bad-4277-8a98-4475cde450b1', -- Matthew Anduha duplicate record
  '6d24ff32-b156-4ff8-8600-d10c1a648efd', -- Rami Imran
  '1664c29e-1e0b-40d2-b9cb-fe1a5756b0c5', -- Taylen Nash
  'ac2bb485-ddac-40ca-b8ce-cc1367656cdc', -- Zion Russell
  '4fdb2e83-e66c-465e-8df4-076174e70b82', -- Jacob Causer active record
  'bf948376-1022-4927-96a3-a319f4ef4bd3', -- Jacob Causer duplicate record
  '7d0c36e9-2741-4b1e-8984-4a107aaf2114', -- Jorge Oyervidez
  'af13f7f5-789e-4d92-81dc-1511efcc8fab', -- Moody Imran
  'b74773e4-1f12-4453-96ae-0453dcd0d1f1'  -- Gio Secor (voice request: "Serral")
);

create table if not exists public.agency_branding (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 2 and 80),
  subdomain text not null check (subdomain ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  accent_color text not null default '#d4a900' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  show_personal_deals boolean not null default true,
  show_leaderboard boolean not null default true,
  show_recruiting boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.agency_branding enable row level security;

drop policy if exists agency_branding_owner_read on public.agency_branding;
create policy agency_branding_owner_read on public.agency_branding
for select to authenticated
using (owner_user_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists agency_branding_owner_write on public.agency_branding;
create policy agency_branding_owner_write on public.agency_branding
for update to authenticated
using (owner_user_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role))
with check (owner_user_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role));

grant select, update on public.agency_branding to authenticated;
grant all on public.agency_branding to service_role;

insert into public.agency_branding (owner_user_id, display_name, subdomain)
values
  ('811fc5f4-05f4-446e-a916-445ce7fd051f', 'Apex Financial', 'apex'),
  ('f0b788de-dacc-45d6-b596-f7925fbd4e27', 'Marcus Agency', 'marcus')
on conflict (owner_user_id) do nothing;

create or replace function public.get_my_agency_branding()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.agency_branding%rowtype;
  v_can_edit boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('display_name','Apex Financial','subdomain','apex','accent_color','#d4a900','show_personal_deals',true,'show_leaderboard',true,'show_recruiting',true,'can_edit',false);
  end if;

  select * into v_row from public.agency_branding where owner_user_id = v_uid;
  if found then
    v_can_edit := true;
  else
    with recursive chain as (
      select a.id, a.user_id, coalesce(a.invited_by_manager_id, a.manager_id) as parent_id,
             array[a.id] as path, 0 as depth
      from (
        select * from public.agents
        where user_id = v_uid
        order by case when status = 'active' then 0 else 1 end, created_at desc
        limit 1
      ) a
      union all
      select p.id, p.user_id, coalesce(p.invited_by_manager_id, p.manager_id),
             c.path || p.id, c.depth + 1
      from chain c
      join public.agents p on p.id = c.parent_id
      where c.depth < 20 and not p.id = any(c.path)
    )
    select b.* into v_row
    from chain c join public.agency_branding b on b.owner_user_id = c.user_id
    order by c.depth
    limit 1;
  end if;

  if v_row.owner_user_id is null then
    return jsonb_build_object('display_name','Apex Financial','subdomain','apex','accent_color','#d4a900','show_personal_deals',true,'show_leaderboard',true,'show_recruiting',true,'can_edit',false);
  end if;
  return to_jsonb(v_row) || jsonb_build_object('can_edit', v_can_edit);
end;
$$;

create or replace function public.save_my_agency_branding(
  p_display_name text,
  p_subdomain text,
  p_accent_color text,
  p_show_personal_deals boolean,
  p_show_leaderboard boolean,
  p_show_recruiting boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.agency_branding where owner_user_id = v_uid) then
    raise exception 'Agency branding is available only to a pre-wired agency owner' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_display_name,''))) not between 2 and 80 then raise exception 'Agency name must be 2-80 characters'; end if;
  if lower(btrim(coalesce(p_subdomain,''))) !~ '^[a-z0-9][a-z0-9-]{1,39}$' then raise exception 'Workspace slug is invalid'; end if;
  if btrim(coalesce(p_accent_color,'')) !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Accent color is invalid'; end if;

  update public.agency_branding set
    display_name = btrim(p_display_name),
    subdomain = lower(btrim(p_subdomain)),
    accent_color = btrim(p_accent_color),
    show_personal_deals = coalesce(p_show_personal_deals, true),
    show_leaderboard = coalesce(p_show_leaderboard, true),
    show_recruiting = coalesce(p_show_recruiting, true),
    updated_at = now()
  where owner_user_id = v_uid;

  return public.get_my_agency_branding();
end;
$$;

revoke all on function public.get_my_agency_branding() from public, anon;
revoke all on function public.save_my_agency_branding(text,text,text,boolean,boolean,boolean) from public, anon;
grant execute on function public.get_my_agency_branding() to authenticated, service_role;
grant execute on function public.save_my_agency_branding(text,text,text,boolean,boolean,boolean) to authenticated, service_role;

comment on table public.agency_branding is 'Per-owner workspace identity inherited by downline members. Only pre-wired owners may edit.';
