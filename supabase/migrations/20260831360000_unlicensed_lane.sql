-- MP-356: the unlicensed lane — their own Slack room, every milestone in it,
-- and a training path that is only about getting licensed.
--
-- Sam's spec, in his order:
--   * unlicensed go in Slack; they get their own pool
--   * EVERY deal notification lands there — competitive culture, pushes people
--   * anyone getting licensed is announced there
--   * hire notifications there
--   * fingerprints done there
--   * course purchased there
--   * a daily link to book the questions call
--   * they do NOT touch the APEX sales courses. The only thing they watch is
--     "how to get your insurance licence"
--
-- WHY THE EVENTS ALREADY EXIST. fn_capture_application_licensing_milestone
-- already emits enrolled_course, completed_course, scheduled_exam, passed_exam,
-- fingerprints_submitted and license_issued. Nothing new needs to be detected —
-- these milestones were being captured and simply never routed anywhere the
-- unlicensed cohort could see them. This adds ROUTES, not new detection, which
-- is why it cannot double-send or invent a milestone that did not happen.
--
-- THE ROOM IS STILL ARCHIVED. #general-unlicensed (C0BSUGBR62G) exists and is
-- archived in Slack; the bot holds chat:write, chat:write.public, channels:read
-- and groups:read but NOT channels:manage, proven via auth.test, so it can
-- neither unarchive nor create. Every route below is therefore written to be
-- correct and dormant: the dispatcher will deliver the moment a human unarchives
-- it, and slack-announce already reports 'refused / is_archived' rather than
-- failing silently until then.

begin;

-- ---------------------------------------------------------------------------
-- 1. Route the four event families into the unlicensed room.
-- ---------------------------------------------------------------------------
insert into public.messaging_route_rules
  (installation_id, event_type, destination_id, audience_scope, template_version, is_enabled)
select i.id, e.event_type, d.id, 'organization', 1, true
from public.messaging_workspace_installations i
cross join public.messaging_destinations d
cross join (values
  ('deal.posted'),                    -- every sale, for the competitive floor
  ('agent.hired'),                    -- new people arriving
  ('candidate.licensing_milestone')   -- course bought, fingerprints, licence issued
) as e(event_type)
where i.provider = 'slack'
  and d.channel_name = 'general-unlicensed'
  and not exists (
    select 1 from public.messaging_route_rules r
     where r.event_type = e.event_type and r.destination_id = d.id
  );

-- ---------------------------------------------------------------------------
-- 2. The daily post: what moved, and the link to book the questions call.
-- ---------------------------------------------------------------------------
-- Replaces MP-347's digest. Same honesty rule — lead with MOVEMENT and say so
-- plainly when nothing moved, because 90% of this cohort sits at 'unlicensed'
-- and a standing-count-only post becomes wallpaper inside a week.
create or replace function public.fn_unlicensed_slack_digest()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_moved integer := 0;
  v_lines text := '';
  v_counts text := '';
  v_book text;
  r record;
begin
  select coalesce(nullif(btrim(value::text), ''), '')
    into v_book
    from public.system_settings
   where key = 'onboarding_call_scheduling_url'
   limit 1;
  v_book := replace(coalesce(v_book, ''), '"', '');

  -- Milestones are the real movement for this cohort: a course bought, an exam
  -- scheduled, fingerprints done, a licence issued.
  select count(*) into v_moved
  from public.licensing_milestone_events
  where created_at >= now() - interval '24 hours';

  for r in
    select milestone_type, count(*) as n
    from public.licensing_milestone_events
    where created_at >= now() - interval '24 hours'
    group by milestone_type
    order by count(*) desc
    limit 6
  loop
    v_lines := v_lines || format('   • %s × %s%s', r.n, replace(r.milestone_type, '_', ' '), chr(10));
  end loop;

  for r in
    select coalesce(a.license_progress::text, 'not started') as stage, count(*) as n
    from public.applications a
    where a.terminated_at is null and a.contracted_at is null and a.closed_at is null
      and coalesce(a.license_status::text, '') <> 'licensed'
    group by 1 order by count(*) desc
  loop
    v_counts := v_counts || format('   • %s — %s%s', r.n, replace(r.stage, '_', ' '), chr(10));
  end loop;

  return format(
    '*Licensing floor — %s*%s%s%s%s',
    to_char(v_today, 'Mon DD'),
    chr(10) || chr(10),
    case
      when v_moved = 0
        then ':warning: *Nobody moved a step in the last 24 hours.* One call, one form, one video — pick the smallest one and do it today.' || chr(10) || chr(10)
      else format(':fire: *%s steps forward in the last 24 hours*%s%s%s', v_moved, chr(10), v_lines, chr(10))
    end,
    '*Where the floor stands*' || chr(10) || v_counts || chr(10),
    case when v_book <> ''
      then format(':telephone_receiver: *Questions? Book a call any day:* %s', v_book)
      else ':telephone_receiver: Ask your manager to book you a questions call.'
    end
  );
end;
$function$;

comment on function public.fn_unlicensed_slack_digest() is
  'MP-356: daily post for the unlicensed room. Leads with real milestone '
  'MOVEMENT from licensing_milestone_events, states plainly when nothing moved, '
  'and always carries the questions-call booking link read live from '
  'system_settings so it cannot drift from the link the emails send.';

commit;
