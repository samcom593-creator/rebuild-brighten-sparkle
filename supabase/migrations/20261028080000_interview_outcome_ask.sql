-- MP-309 (2026-10-28): the one-tap outcome loop for booked calls. Sam: "optimize my Calendly, maximum usability
-- engagement". Measured first: 113 Calendly bookings in 90 days (91 Licensed/Leader, 12 Licensed via email, 6
-- onboarding, 2 final-expense), outcome recorded on exactly 1. The surface to log outcomes exists
-- (/dashboard/interview-recovery, cc_dispose_interview) and nobody reaches for it, so 20 minutes after each call
-- ends Sam's phone gets one push with four links: Showed / No-show / Hired / No answer. Each link is a signed
-- one-tap (interview-outcome edge function, HMAC of id:outcome under the bot token) that calls the same
-- cc_dispose_interview the page uses, marks the Calendly invitee no-show through Calendly's API, and emails the
-- prospect their reschedule link when they did not show. Asked once per booking (raw_payload.outcome_asked_at);
-- pushes go through fn_ntfy_relay, whose result is read back so a 429 from ntfy is recorded as not asked.

create or replace function public.fn_interview_outcome_ask()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r record;
  v_tok text;
  v_base text := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/interview-outcome';
  v_asked integer := 0;
  v_failed integer := 0;
  v_body text;
  v_req bigint;
  v_id bigint;
  k text;
begin
  select decrypted_secret into v_tok from vault.decrypted_secrets where name = 'apex_bot_token' limit 1;
  if v_tok is null then return jsonb_build_object('error', 'no bot token'); end if;
  for r in
    select e.id, e.invitee_name, e.invitee_phone, e.event_type_name, e.scheduled_at
      from public.interview_events e
     where e.canceled_at is null and e.outcome is null
       and e.scheduled_at < now() - interval '20 minutes'
       and e.scheduled_at > now() - interval '36 hours'
       and (e.raw_payload->>'outcome_asked_at') is null
     order by e.scheduled_at
     limit 8
  loop
    v_body := format('%s · %s · %s%s',
      coalesce(r.invitee_name, 'Someone'),
      to_char(r.scheduled_at at time zone 'America/Phoenix', 'Dy HH12:MI AM'),
      coalesce(r.event_type_name, 'call'),
      case when r.invitee_phone is not null then ' · ' || r.invitee_phone else '' end);
    v_body := v_body || E'\n\n';
    foreach k in array array['completed', 'no_show', 'hired', 'no_answer'] loop
      v_body := v_body || format('%s: %s?id=%s&o=%s&k=%s' || E'\n',
        case k when 'completed' then 'Showed' when 'no_show' then 'No-show' when 'hired' then 'Hired' else 'No answer' end,
        v_base, r.id, k, encode(extensions.hmac(convert_to(r.id::text || ':' || k, 'UTF8'), convert_to(v_tok, 'UTF8'), 'sha256'), 'hex'));
    end loop;
    begin
      select public.fn_ntfy_relay('Did ' || coalesce(split_part(r.invitee_name, ' ', 1), 'they') || ' show?', v_body, '4', 'phone') into v_req;
      perform pg_sleep(1.2);
      select public.fn_ntfy_relay_result(v_req) into v_id;
      if v_id is not null then
        update public.interview_events set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('outcome_asked_at', now(), 'outcome_ask_ntfy_id', v_id) where id = r.id;
        v_asked := v_asked + 1;
      else
        v_failed := v_failed + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('asked', v_asked, 'failed', v_failed, 'at', now());
end $fn$;
revoke all on function public.fn_interview_outcome_ask() from public, anon, authenticated;

do $$
declare j bigint;
begin
  for j in select jobid from cron.job where jobname = 'apex-interview-outcome-ask' loop perform cron.unschedule(j); end loop;
  perform cron.schedule('apex-interview-outcome-ask', '*/15 * * * *', 'select public.fn_interview_outcome_ask()');
end $$;

-- One row in every state, never blank-green: how many calls ended without an outcome, how many were asked, and
-- how long the oldest unanswered ask has waited. Check #106 reads it.
create or replace view public.v_interview_outcome_truth as
select
  (select count(*) from public.interview_events where canceled_at is null and scheduled_at < now() - interval '20 minutes' and scheduled_at > now() - interval '7 days') as calls_ended_7d,
  (select count(*) from public.interview_events where canceled_at is null and scheduled_at < now() - interval '20 minutes' and scheduled_at > now() - interval '7 days' and outcome is not null) as outcomes_7d,
  (select count(*) from public.interview_events where canceled_at is null and scheduled_at < now() - interval '20 minutes' and scheduled_at > now() - interval '7 days' and raw_payload->>'outcome_asked_at' is not null) as asked_7d,
  (select count(*) from public.interview_events where canceled_at is null and outcome is null and scheduled_at < now() - interval '20 minutes' and scheduled_at > now() - interval '36 hours' and raw_payload->>'outcome_asked_at' is null) as unasked_now,
  (select round(extract(epoch from (now() - min(scheduled_at))) / 3600) from public.interview_events where canceled_at is null and outcome is null and scheduled_at < now() - interval '20 minutes' and scheduled_at > now() - interval '36 hours' and raw_payload->>'outcome_asked_at' is null) as oldest_unasked_h,
  (select max((raw_payload->>'outcome_asked_at')::timestamptz) from public.interview_events) as last_ask_at;
revoke all on public.v_interview_outcome_truth from public, anon, authenticated;
