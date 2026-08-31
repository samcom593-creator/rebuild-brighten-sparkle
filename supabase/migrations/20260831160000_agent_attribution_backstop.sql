-- MP-336: every new agent inherits their recruiter and their name from the
-- application, no matter which of the seven writers minted the row.
--
-- SAM'S SPEC, verbatim concept: "put the hire under Obi. They send the invite
-- link, and that follows that one. Not a very hard concept." The chain already
-- exists in pieces — invite token falls back to its sender
-- (consume-invite-token:144), the application carries recruiter_id /
-- assigned_agent_id, and z_default_agent_manager_to_sam now prefers
-- invited_by_manager_id. The break is the LAST hop: several writers mint the
-- agent row without copying attribution off the application.
--
-- Measured, not assumed. Seven paths insert into agents:
--   add-agent            sets display_name + manager + invited_by   (correct)
--   consume-invite-token sets all three                             (correct)
--   claim-account        links, does not mint                       (n/a)
--   InviteTeamModal      sets invited_by, NO display_name           (broken)
--   self-enroll-course   set NOTHING of the three                   (broken, fixed this wave)
--   flex_hire            no invited_by                              (broken)
--   apex_provision_licensed_applicant  no invited_by                (broken)
--
-- The cost is not cosmetic: self-enroll minted a nameless "active" agent
-- tonight and trg_notify_agent_hired DELIVERED "unnamed agent" hire
-- announcements to Slack and Discord. And a hire missing invited_by lands
-- under the owner by default, which the previous wave measured at 52
-- misparented agents / $221,331 of 90-day ALP paying override to the wrong
-- person.
--
-- Patching each writer treats the instance; this trigger treats the class,
-- including writers that do not exist yet. Trigger name starts with trg_y_ so
-- it fires BEFORE z_default_agent_manager_to_sam (BEFORE-INSERT triggers fire
-- alphabetically): y fills invited_by from the application, z turns invited_by
-- into manager_id. Chain complete.

begin;

create or replace function public.fn_y_agent_attribution_from_application()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Scalars, not a record: `if v_app.id is null` on a NEVER-ASSIGNED record
  -- variable THROWS in plpgsql, the exception guard below swallowed the throw,
  -- and the email-fallback branch silently degraded to the old behaviour.
  -- Caught only because both branches were proven separately — the
  -- source_application_id test passed and the email test came back empty.
  v_app_id uuid;
  v_first text;
  v_last text;
  v_assigned uuid;
  v_recr_col uuid;
  v_refmgr uuid;
  v_refrec uuid;
  v_email text;
  v_recruiter uuid;
  v_self uuid;
begin
  -- Only fill blanks. A writer that states attribution or a name is trusted.
  if new.invited_by_manager_id is not null
     and nullif(btrim(coalesce(new.display_name, '')), '') is not null then
    return new;
  end if;

  -- Find the application this hire came from: the explicit link first, else
  -- the newest application under the person's email (profile or auth).
  if new.source_application_id is not null then
    select a.id, a.first_name, a.last_name,
           a.assigned_agent_id, a.recruiter_id, a.referral_manager_id, a.referral_recruiter_id
      into v_app_id, v_first, v_last, v_assigned, v_recr_col, v_refmgr, v_refrec
      from public.applications a
     where a.id = new.source_application_id;
  end if;

  if v_app_id is null then
    select lower(coalesce(p.email, u.email)) into v_email
      from (select 1) _
      left join public.profiles p on p.id = new.profile_id
      left join auth.users u on u.id = new.user_id
     limit 1;

    if v_email is not null then
      select a.id, a.first_name, a.last_name,
             a.assigned_agent_id, a.recruiter_id, a.referral_manager_id, a.referral_recruiter_id
        into v_app_id, v_first, v_last, v_assigned, v_recr_col, v_refmgr, v_refrec
        from public.applications a
       where lower(a.email) = v_email
       order by a.created_at desc
       limit 1;
    end if;
  end if;

  if v_app_id is null then
    return new;
  end if;

  -- Name backstop: this is what turned into "unnamed agent" hire announcements
  -- in Slack and Discord — trg_notify_agent_hired reads NEW.display_name, and
  -- BEFORE-INSERT means this fills it in time for that announcement.
  if nullif(btrim(coalesce(new.display_name, '')), '') is null then
    -- btrim each part and collapse inner runs: application names arrive with
    -- stray whitespace and 'Testing  Application' proved it in the branch test.
    new.display_name := nullif(regexp_replace(btrim(
      coalesce(btrim(v_first), '') || ' ' || coalesce(btrim(v_last), '')
    ), '\s+', ' ', 'g'), '');
  end if;

  if new.source_application_id is null then
    new.source_application_id := v_app_id;
  end if;

  if new.invited_by_manager_id is null then
    v_recruiter := coalesce(v_assigned, v_recr_col, v_refmgr, v_refrec);
    if v_recruiter is not null then
      -- Canonicalise (9 rows historically pointed at the duplicate SJAMES02)
      -- and never make someone their own recruiter (the Aisha Kebbeh row).
      v_recruiter := coalesce(public.fn_canonical_agent_id(v_recruiter), v_recruiter);
      v_self := coalesce(public.fn_canonical_agent_id(new.id), new.id);
      if v_recruiter is distinct from v_self then
        new.invited_by_manager_id := v_recruiter;
      end if;
    end if;
  end if;

  return new;
exception when others then
  -- Attribution must never block a hire. A failure here degrades to the old
  -- behaviour (owner default), it does not abort the insert.
  raise warning 'fn_y_agent_attribution_from_application soft-failed for %: %',
    coalesce(new.display_name, new.id::text), sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_y_agent_attribution_from_application on public.agents;
create trigger trg_y_agent_attribution_from_application
  before insert on public.agents
  for each row execute function public.fn_y_agent_attribution_from_application();

comment on function public.fn_y_agent_attribution_from_application() is
  'MP-336: fills display_name, source_application_id and invited_by_manager_id '
  'from the hire''s application when the writer left them blank. Fires before '
  'z_default_agent_manager_to_sam (alphabetical), which then promotes '
  'invited_by into manager_id — so an invite link sent by a manager follows '
  'through to the hire landing under that manager on every write path.';

commit;
