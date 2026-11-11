-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 6/9: a re-application 30+ days later is the live record.
--
-- WHAT
--   1. applications_flag_duplicates() (BEFORE INSERT): when the person's latest application
--      (same email, not a duplicate, record_type 'application') is 30 or more days older than
--      the new one, and no application of theirs was ever hired or contracted, the NEW row is
--      NOT flagged as a duplicate. It is tagged 'reapplication' and keeps the earlier
--      recruiter credit (referral_recruiter_id, first-write-wins as of 2026-06-29) when that
--      agent is still active. Inside 30 days, for anyone who was ever hired, or for an
--      address whose login is suspended or banned (fn_email_is_suspended), behaviour is
--      unchanged (the new row is the duplicate), so a banned person never re-enters the SLA
--      queue, the pager or the ladder through a second form. Forward-only: inserts after
--      fn_anchor_pkg1_cutoff() only.
--   2. fn_applications_reapply_supersede() (AFTER INSERT, trg_applications_reapply_supersede):
--      for a 'reapplication' row, the older rows with that email close their active ladder row
--      (closed_lost, metadata.superseded_by) and become duplicates OF THE NEW ROW. So the new
--      row enters the ladder ('applied' or 'licensed_book_call', via the existing insert
--      trigger) and the SLA queue, and the old row stays out of both: no double message.
--      Never blocks the insert (exception-wrapped).
--   3. fn_anchor_pkg1_reapply_catchup(ids[], p_dry_run default TRUE, p_max default 3): the
--      ONE-TIME catch-up for re-applications that landed before this migration (Havon
--      a27abadd, Brayden d7ba01f3, Kirsten 1afcf998). Explicit list, capped, dry run unless
--      p_dry_run => false. Not scheduled.
-- WHY
--   funnel_now.md section 6.1 / shipped_vs_live.md 7.3: a re-application was flagged
--   is_duplicate (the ladder, the SLA queue and the pager all skip duplicates) while
--   submit-application terminated the original, so the person sat in NO queue. 6
--   re-applications in Oct-Nov; 5 of the 6 originals were never human-touched. A second
--   application is stronger intent than a first.
-- NOT CHANGED
--   A repeat INSIDE 30 days whose earlier row is rejected / disqualified / no_pickup / closed
--   is still flagged a duplicate of that row, which submit-application then terminates
--   (pre-existing). Measured 2026-11-11: 0 such re-applications in the last 90 days. Whether
--   a person the owner rejected may re-enter the ladder is an owner decision, not a fix.
-- ROLLBACK
--   drop trigger if exists trg_applications_reapply_supersede on public.applications;
--   drop function if exists public.fn_applications_reapply_supersede();
--   drop function if exists public.fn_anchor_pkg1_reapply_catchup(uuid[], boolean, integer);
--   do $$ begin execute (select value from public.system_settings where key = 'anchor_pkg1_flagdup_backup'); end $$;
--   (rows already made live stay live; re-flag by hand if wanted:
--    update applications set is_duplicate = true, duplicate_of = <older id> where id = <new id>)

insert into public.system_settings (key, value, updated_at)
values ('anchor_pkg1_flagdup_backup', pg_get_functiondef('public.applications_flag_duplicates()'::regprocedure), now())
on conflict (key) do nothing;

create or replace function public.applications_flag_duplicates()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
DECLARE
  v_canonical    uuid;
  v_latest_prior timestamptz;
  v_prior_credit uuid;
  v_now          timestamptz := coalesce(NEW.created_at, now());
BEGIN
  IF NEW.is_duplicate IS TRUE OR NEW.email IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_canonical
  FROM public.applications
  WHERE id <> NEW.id
    AND lower(email) = lower(NEW.email)
    AND is_duplicate IS NOT TRUE
    AND terminated_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_canonical IS NULL THEN RETURN NEW; END IF;

  -- MP-ONBOARD-ANCHOR-PKG1: a re-application 30+ days after the latest one is the live
  -- record (see the migration header). Same 30 days as submit-application's
  -- REAPPLY_LIVE_AFTER_DAYS.
  IF coalesce(NEW.record_type, 'application') = 'application'
     AND v_now >= public.fn_anchor_pkg1_cutoff() THEN
    SELECT max(p.created_at) INTO v_latest_prior
      FROM public.applications p
     WHERE p.id <> NEW.id
       AND lower(p.email) = lower(NEW.email)
       AND p.is_duplicate IS NOT TRUE
       AND coalesce(p.record_type, 'application') = 'application';
    IF v_latest_prior IS NOT NULL
       AND v_latest_prior <= v_now - interval '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.applications p
          WHERE p.id <> NEW.id
            AND lower(p.email) = lower(NEW.email)
            AND (p.contracted_at IS NOT NULL OR public.fn_application_has_agent(p.id)))
       -- a suspended or banned login never comes back as a live record (same rule as the
       -- catch-up below and every PKG1 sender)
       AND NOT public.fn_email_is_suspended(NEW.email)
    THEN
      NEW.tags := ARRAY(SELECT DISTINCT t FROM unnest(coalesce(NEW.tags, '{}'::text[]) || ARRAY['reapplication']) t);
      -- first-write-wins recruiter credit (2026-06-29): keep the earlier credit while that
      -- agent is still active, so a resubmitted form cannot move the recruit.
      SELECT p.referral_recruiter_id INTO v_prior_credit
        FROM public.applications p
        JOIN public.agents g ON g.id = p.referral_recruiter_id
       WHERE p.id <> NEW.id
         AND lower(p.email) = lower(NEW.email)
         AND p.referral_recruiter_id IS NOT NULL
         AND g.is_inactive IS NOT TRUE
         AND g.is_deactivated IS NOT TRUE
         AND coalesce(g.status::text, '') NOT IN ('inactive', 'terminated')
       ORDER BY p.created_at DESC
       LIMIT 1;
      IF v_prior_credit IS NOT NULL THEN
        NEW.referral_recruiter_id := v_prior_credit;
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  NEW.is_duplicate := true;
  NEW.duplicate_of := v_canonical;
  RETURN NEW;
END;
$function$;

create or replace function public.fn_applications_reapply_supersede()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_duplicate is true or new.email is null
     or not ('reapplication' = any (coalesce(new.tags, '{}'::text[]))) then
    return new;
  end if;
  begin
    -- the old ladder row stops first (the duplicate flag below hides it from the view, and a
    -- hidden row would otherwise stay 'active' until the nightly recompute)
    update public.next_step_progress p
       set status = 'closed_lost', updated_at = now(),
           metadata = coalesce(p.metadata, '{}'::jsonb)
                      || jsonb_build_object('superseded_by', new.id, 'superseded_at', now(), 'reason', 'reapplication')
      from public.applications o
     where p.application_id = o.id
       and p.status = 'active'
       and o.id <> new.id
       and lower(o.email) = lower(new.email)
       and o.is_duplicate is not true
       and coalesce(o.record_type, 'application') = 'application';
    update public.applications o
       set is_duplicate = true, duplicate_of = new.id
     where o.id <> new.id
       and lower(o.email) = lower(new.email)
       and o.is_duplicate is not true
       and coalesce(o.record_type, 'application') = 'application';
  exception when others then
    -- never roll back an application insert over bookkeeping
    raise warning 'fn_applications_reapply_supersede: %', sqlerrm;
  end;
  return new;
end
$$;

revoke all on function public.fn_applications_reapply_supersede() from public, anon, authenticated;

drop trigger if exists trg_applications_reapply_supersede on public.applications;
create trigger trg_applications_reapply_supersede
  after insert on public.applications
  for each row execute function public.fn_applications_reapply_supersede();

-- One-time catch-up for re-applications flagged before this migration. Dry run by default.
create or replace function public.fn_anchor_pkg1_reapply_catchup(
  p_application_ids uuid[],
  p_dry_run boolean default true,
  p_max integer default 3)
returns table (application_id uuid, first_name text, superseded_ids uuid[], verdict text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_id      uuid;
  n         record;
  v_prior   timestamptz;
  v_others  uuid[];
  v_done    integer := 0;
begin
  foreach v_id in array coalesce(p_application_ids, '{}'::uuid[]) loop
    exit when v_done >= greatest(0, least(coalesce(p_max, 3), 10));
    select x.id, x.first_name, x.email, x.created_at, x.is_duplicate, x.record_type, x.terminated_at
      into n
      from public.applications x
     where x.id = v_id;
    application_id := v_id;
    first_name := null;
    superseded_ids := null;
    if not found then
      verdict := 'not_found'; return next; continue;
    end if;
    first_name := btrim(n.first_name);
    if n.email is null then verdict := 'no_email'; return next; continue; end if;
    if coalesce(n.record_type, 'application') <> 'application' then verdict := 'not_an_application'; return next; continue; end if;
    if n.terminated_at is not null then verdict := 'terminated'; return next; continue; end if;
    if n.is_duplicate is not true then verdict := 'already_live'; return next; continue; end if;
    if exists (select 1 from public.applications o
                where o.id <> n.id and lower(o.email) = lower(n.email)
                  and o.created_at > n.created_at) then
      verdict := 'newer_application_exists'; return next; continue;
    end if;
    select max(o.created_at), array_agg(o.id order by o.created_at)
      into v_prior, v_others
      from public.applications o
     where o.id <> n.id and lower(o.email) = lower(n.email)
       and coalesce(o.record_type, 'application') = 'application';
    superseded_ids := v_others;
    if v_prior is null or v_prior > n.created_at - interval '30 days' then
      verdict := 'not_a_reapplication_30d'; return next; continue;
    end if;
    if exists (select 1 from public.applications o
                where lower(o.email) = lower(n.email)
                  and (o.contracted_at is not null or public.fn_application_has_agent(o.id))) then
      verdict := 'was_hired'; return next; continue;
    end if;
    if public.fn_email_is_suspended(n.email) then
      verdict := 'suspended'; return next; continue;
    end if;
    if coalesce(p_dry_run, true) then
      verdict := 'would_make_live'; v_done := v_done + 1; return next; continue;
    end if;
    update public.next_step_progress p
       set status = 'closed_lost', updated_at = now(),
           metadata = coalesce(p.metadata, '{}'::jsonb)
                      || jsonb_build_object('superseded_by', n.id, 'superseded_at', now(), 'reason', 'reapplication_catchup')
     where p.application_id = any (v_others) and p.status = 'active';
    update public.applications o
       set is_duplicate = true, duplicate_of = n.id
     where o.id = any (v_others) and o.is_duplicate is not true;
    update public.applications x
       set is_duplicate = false, duplicate_of = null,
           tags = array(select distinct t from unnest(coalesce(x.tags, '{}'::text[]) || array['reapplication']) t)
     where x.id = n.id;
    verdict := 'made_live';
    v_done := v_done + 1;
    return next;
  end loop;
end
$$;

comment on function public.fn_anchor_pkg1_reapply_catchup(uuid[], boolean, integer) is
  'MP-ONBOARD-ANCHOR-PKG1 one-time catch-up: makes listed pre-migration re-applications (30+ days after the latest application, never hired, not suspended) the live record. Dry run unless p_dry_run => false; capped by p_max (<= 10). Not scheduled.';

revoke all on function public.fn_anchor_pkg1_reapply_catchup(uuid[], boolean, integer) from public, anon, authenticated;
grant execute on function public.fn_anchor_pkg1_reapply_catchup(uuid[], boolean, integer) to service_role;
