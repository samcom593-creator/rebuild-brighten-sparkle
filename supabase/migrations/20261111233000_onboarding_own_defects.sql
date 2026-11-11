-- onboarding-own-defects (2026-11-11): attribution attaches only on one unambiguous record.
--
-- fn_y_agent_attribution_from_application (BEFORE INSERT on agents) fills a new hire's display
-- name, source_application_id and recruiter from "the newest application under the person's
-- email". Newest of ANY row: 25 addresses hold more than one applications row, 6 of them under
-- different names and 9 with different recruiters, and every one of those extra rows is a
-- duplicate or a test record. So a hire could be announced under someone else's name and
-- credited to someone else's recruiter, and one agent today is sourced from a duplicate row.
--
-- Measured before changing (live, 2026-11-11): live (non-duplicate) applications are unique per
-- address (0 collisions); 33 addresses have only an interview_booking record; 0 addresses have
-- both an application and a booking; no agent has ever been sourced from a booking or test row.
--
-- Rule now, for the email fallback only (the explicit source_application_id path is unchanged):
--   candidates = rows under the address (case- and space-insensitive) that are not duplicates;
--   exactly one live application -> attach it; else no application and exactly one
--   interview_booking -> attach it; anything else attaches nothing and raises a WARNING.
-- A blank name on an ambiguous hire is better than someone else's name in a hire announcement.
-- Everything else in the function is restated byte-for-byte from the live definition.

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
  v_n_app int;
  v_n_booking int;
  v_tier text;
begin
  -- Only fill blanks. A writer that states attribution or a name is trusted.
  if new.invited_by_manager_id is not null
     and nullif(btrim(coalesce(new.display_name, '')), '') is not null then
    return new;
  end if;

  -- Find the application this hire came from: the explicit link first, else
  -- the one unambiguous record under the person's email (profile or auth).
  if new.source_application_id is not null then
    select a.id, a.first_name, a.last_name,
           a.assigned_agent_id, a.recruiter_id, a.referral_manager_id, a.referral_recruiter_id
      into v_app_id, v_first, v_last, v_assigned, v_recr_col, v_refmgr, v_refrec
      from public.applications a
     where a.id = new.source_application_id;
  end if;

  if v_app_id is null then
    select lower(btrim(coalesce(p.email, u.email))) into v_email
      from (select 1) _
      left join public.profiles p on p.id = new.profile_id
      left join auth.users u on u.id = new.user_id
     limit 1;

    if nullif(v_email, '') is not null then
      select count(*) filter (where coalesce(a.record_type, 'application') = 'application'),
             count(*) filter (where a.record_type = 'interview_booking')
        into v_n_app, v_n_booking
        from public.applications a
       where lower(btrim(a.email)) = v_email
         and coalesce(a.is_duplicate, false) = false;

      v_tier := case
                  when v_n_app = 1 then 'application'
                  when v_n_app = 0 and v_n_booking = 1 then 'interview_booking'
                end;

      if v_tier is not null then
        select a.id, a.first_name, a.last_name,
               a.assigned_agent_id, a.recruiter_id, a.referral_manager_id, a.referral_recruiter_id
          into v_app_id, v_first, v_last, v_assigned, v_recr_col, v_refmgr, v_refrec
          from public.applications a
         where lower(btrim(a.email)) = v_email
           and coalesce(a.is_duplicate, false) = false
           and coalesce(a.record_type, 'application') = v_tier;
      elsif v_n_app > 1 or v_n_booking > 1 then
        raise warning 'fn_y_agent_attribution_from_application: % live applications and % bookings share the new hire''s email; attribution left blank rather than guessed',
          v_n_app, v_n_booking;
      end if;
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
