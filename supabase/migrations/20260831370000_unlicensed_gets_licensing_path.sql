begin;

-- MP-357: unlicensed hires get a licensing path, not the sales course.
--
-- Sam: "for training course, they don't have to go through any of the APEX
-- training courses at all for a licence. What they go over is the 'how to get
-- your insurance licence' video."
--
-- Today an unlicensed hire receives send-course-enrollment-email — the APEX
-- SALES course — because add-agent fires it on has_training_course regardless
-- of licence. Meanwhile fn_enqueue_hired_licensed_onboarding returns early for
-- anyone unlicensed, so they get no Slack invite and no questions call either.
-- The result is exactly backwards: the wrong course, and none of the things
-- that would actually help them get licensed.
--
-- /get-licensed already exists as a PUBLIC page carrying the licensing video
-- and the XCEL partner link, so this routes them there rather than inventing a
-- new surface.
alter table public.agent_onboarding_queue drop constraint if exists agent_onboarding_queue_email_kind_check;
alter table public.agent_onboarding_queue add constraint agent_onboarding_queue_email_kind_check
  check (email_kind = any (array['course','discord','hired_whatsapp','onboarding_call','get_licensed']));

create or replace function public.fn_enqueue_hired_licensed_onboarding()
returns trigger
language plpgsql
security definer
as $function$
declare
  should_fire boolean;
  v_licensed boolean;
begin
  -- MP-353 employment gate: a hire event is "employed", never merely a status
  -- change. A licence backfill on an ex-agent is not an onboarding trigger.
  if coalesce(new.status::text, '') <> 'active'
     or coalesce(new.is_deactivated, false)
     or coalesce(new.is_inactive, false) then
    return new;
  end if;

  v_licensed := (new.license_status::text = 'licensed');

  if tg_op = 'INSERT' then
    should_fire := (new.onboarding_stage = 'live') or (new.status = 'active');
  else
    should_fire := (
         (old.onboarding_stage is distinct from new.onboarding_stage and new.onboarding_stage = 'live')
      or (old.status is distinct from new.status and new.status = 'active' and coalesce(old.status::text, '') not in ('active', 'live'))
      or (old.license_status is distinct from new.license_status)
    );
  end if;

  if not should_fire then
    return new;
  end if;

  if v_licensed then
    -- Licensed: sales course, community, and the onboarding call.
    if pg_trigger_depth() = 1 and coalesce(new.has_training_course, false) = false then
      update public.agents set has_training_course = true, updated_at = now()
       where id = new.id and coalesce(has_training_course, false) = false;
    end if;

    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'course', now()), (new.id, 'discord', now())
    on conflict (agent_id, email_kind) do nothing;

    begin
      perform public.fn_enqueue_onboarding_call_booking(new.id, 'trigger:' || tg_op);
    exception when others then
      raise warning 'fn_enqueue_onboarding_call_booking failed for agent %: %', new.id, sqlerrm;
    end;
  else
    -- MP-357 unlicensed: the licensing path and the team room. Explicitly NOT
    -- 'course' — the APEX sales course is not what gets someone licensed, and
    -- sending it is how a pre-licence hire ends up in the wrong material.
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'get_licensed', now()), (new.id, 'discord', now())
    on conflict (agent_id, email_kind) do nothing;
  end if;

  return new;
end;
$function$;

comment on function public.fn_enqueue_hired_licensed_onboarding() is
  'MP-357: cohort-correct onboarding. Licensed -> sales course + community + '
  'onboarding call. Unlicensed -> get_licensed (the licensing video and XCEL) + '
  'community, never the sales course. Both gated on ACTIVE employment (MP-353).';

commit;
