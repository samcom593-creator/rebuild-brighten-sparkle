-- MP-362 proof harness. Runs against LIVE prod inside one transaction that
-- always ROLLS BACK, so no auth user, profile, role or failure row survives it.
-- Precedent: MP-325 measured the row-policy alternative in a rolled-back prod
-- transaction rather than reasoning about it.
--
-- It exercises the DEPLOYED functions, never a reimplementation, and it includes
-- a mutation (M1) that restores the PRE-FIX single-block handle_new_user and
-- replays the same fixture. If M1 does not lose the profile, the block
-- separation this migration ships is not load-bearing and the harness says so.
begin;
create temp table _r(seq int, case_name text, detail text, verdict text);
create or replace function pg_temp.mk(p_email text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
          p_email, 'x', now(), now(), '{}'::jsonb, '{}'::jsonb);
  return v;
end $f$;

create or replace function pg_temp.boom() returns trigger language plpgsql as $b$
begin raise exception 'MP-362 injected fault' using errcode='XX000'; end $b$;

do $$
declare u uuid; b int; nprof int; nrole int; nfail int; got text;
begin
  b := (select count(*) from auth_provision_failures);
  insert into _r values (0,'P0 baseline unresolved failure rows', b::text,
                         case when b=0 then 'PASS' else 'NOTE' end);

  ---------------------------------------------------------------- P1 happy path
  u := pg_temp.mk('mp362-happy@example.invalid');
  select count(*) into nprof from profiles where user_id=u;
  select count(*) into nrole from user_roles where user_id=u;
  nfail := (select count(*) from auth_provision_failures) - b;
  insert into _r values (1,'P1 normal signup provisions both rows and logs nothing',
    format('profile=%s roles=%s newfails=%s',nprof,nrole,nfail),
    case when nprof=1 and nrole=1 and nfail=0 then 'PASS' else 'FAIL' end);

  ------------------------------------------- P2 profiles insert fails -> RECORDED
  create trigger _mp362_break_profiles before insert on public.profiles
    for each row execute function pg_temp.boom();
  b := (select count(*) from auth_provision_failures);
  u := pg_temp.mk('mp362-profbreak@example.invalid');   -- must NOT raise
  select count(*) into nprof from profiles where user_id=u;
  select step into got from auth_provision_failures where user_id=u;
  nfail := (select count(*) from auth_provision_failures) - b;
  insert into _r values (2,'P2 profiles insert fails: signup survives AND names itself',
    format('signup_ok=yes profile=%s newfails=%s step=%s',nprof,nfail,coalesce(got,'<none>')),
    case when nprof=0 and nfail=1 and got='profiles' then 'PASS' else 'FAIL' end);
  drop trigger _mp362_break_profiles on public.profiles;

  --------------------------- P3 user_roles insert fails -> profile MUST SURVIVE
  create trigger _mp362_break_roles before insert on public.user_roles
    for each row execute function pg_temp.boom();
  b := (select count(*) from auth_provision_failures);
  u := pg_temp.mk('mp362-rolebreak@example.invalid');
  select count(*) into nprof from profiles where user_id=u;
  select step into got from auth_provision_failures where user_id=u;
  nfail := (select count(*) from auth_provision_failures) - b;
  insert into _r values (3,'P3 user_roles fails: the profile is NOT rolled back with it',
    format('profile=%s newfails=%s step=%s',nprof,nfail,coalesce(got,'<none>')),
    case when nprof=1 and nfail=1 and got='user_roles' then 'PASS' else 'FAIL' end);
  drop trigger _mp362_break_roles on public.user_roles;

  ------------------- M1 mutation: restore the PRE-FIX body, replay P3's fixture
  execute $m$
    create or replace function public.handle_new_user() returns trigger
    language plpgsql security definer set search_path=public as $old$
    BEGIN
      INSERT INTO public.profiles (user_id, email, full_name)
      VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
      ON CONFLICT (user_id) DO NOTHING;
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'agent')
      ON CONFLICT DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN OTHERS THEN
      RETURN NEW;
    END $old$;
  $m$;
  create trigger _mp362_break_roles before insert on public.user_roles
    for each row execute function pg_temp.boom();
  b := (select count(*) from auth_provision_failures);
  u := pg_temp.mk('mp362-mutation@example.invalid');
  select count(*) into nprof from profiles where user_id=u;
  nfail := (select count(*) from auth_provision_failures) - b;
  insert into _r values (4,'M1 pre-fix body on the SAME fixture loses the profile and logs nothing',
    format('profile=%s newfails=%s',nprof,nfail),
    case when nprof=0 and nfail=0 then 'PASS (mutation is load-bearing)' else 'FAIL (fix proves nothing)' end);
  drop trigger _mp362_break_roles on public.user_roles;
end $$;

select seq, case_name, detail, verdict from _r order by seq;
rollback;
