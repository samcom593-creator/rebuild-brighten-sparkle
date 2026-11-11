-- MP-ONBOARD-REAL-NAMES (2026-11-11).
--
-- Measured: 476 profiles carry the person's EMAIL ADDRESS as full_name (the signup default), so
-- every onboarding email that greets by profile name opens "Hi darinfoxcroft16@gmail.com". 432 of
-- them have a real first + last name on their own application under the same email.
--
-- 1) Backfill those 432 from the newest application with a usable name. Pre-images are stored in
--    ops_preimage_snapshots (reason 'MP-ONBOARD-REAL-NAMES 2026-11-11') so it is reversible.
-- 2) Keep it fixed: when an application arrives or is corrected, a profile under the same email
--    whose name is still an email address takes the application's name. A name a person or an
--    admin has already set is never overwritten.
insert into public.ops_preimage_snapshots (reason, payload)
select 'MP-ONBOARD-REAL-NAMES 2026-11-11', jsonb_agg(jsonb_build_object('profile_id', p.id, 'full_name', p.full_name))
from public.profiles p
where p.full_name like '%@%'
  and not exists (select 1 from public.ops_preimage_snapshots s where s.reason = 'MP-ONBOARD-REAL-NAMES 2026-11-11')
having count(*) > 0;

update public.profiles p
   set full_name = src.new_name
  from (
    select p2.id,
           (select regexp_replace(btrim(ap.first_name || ' ' || ap.last_name), '\s+', ' ', 'g')
              from public.applications ap
             where lower(ap.email) = lower(p2.email)
               and length(btrim(coalesce(ap.first_name, ''))) >= 2
               and length(btrim(coalesce(ap.last_name, ''))) >= 2
               and ap.first_name !~ '@'
             order by ap.created_at desc limit 1) as new_name
    from public.profiles p2
    where p2.full_name like '%@%'
  ) src
 where src.id = p.id and src.new_name is not null;

create or replace function public.trg_profile_name_from_application()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.email is not null
     and length(btrim(coalesce(new.first_name, ''))) >= 2
     and length(btrim(coalesce(new.last_name, ''))) >= 2
     and new.first_name !~ '@' then
    update public.profiles p
       set full_name = regexp_replace(btrim(new.first_name || ' ' || new.last_name), '\s+', ' ', 'g')
     where lower(p.email) = lower(new.email) and p.full_name like '%@%';
  end if;
  return new;
exception when others then
  -- a naming nicety must never block an application write
  return new;
end $function$;

drop trigger if exists trg_profile_name_from_application on public.applications;
create trigger trg_profile_name_from_application
after insert or update of first_name, last_name, email on public.applications
for each row execute function public.trg_profile_name_from_application();
