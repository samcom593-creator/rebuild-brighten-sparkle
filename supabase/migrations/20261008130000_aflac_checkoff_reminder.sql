-- Aflac daily check-off: the phone reminder that makes it mandatory (2026-10-08).
--
-- A banner on the home page only works if the home page is opened. This pings the phone at 5 pm Phoenix
-- when today's check-off is still missing, and says nothing when it is done. Reuses fn_ntfy_relay, the
-- database-side relay that exists because the edge-to-ntfy leg is refused on a shared-IP quota, and
-- returns the pg_net request id so the delivery receipt is readable with fn_ntfy_relay_receipt().
--
-- The title is plain ASCII on purpose: header-borne titles die on any character above 0xFF in the edge
-- path (MP-274), and this one costs nothing to keep safe.
--
-- 00:00 UTC is 17:00 Phoenix all year, because Arizona does not observe daylight saving time.

begin;

create or replace function public.aflac_checkoff_reminder(p_topic text default null)
returns jsonb
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_ready int;
  v_req bigint;
begin
  if exists (select 1 from public.aflac_daily_checkoffs where check_date = v_today) then
    return jsonb_build_object('sent', false, 'reason', 'already_checked_off');
  end if;

  select count(*) into v_ready
  from public.contracting_intakes i
  join public.aflac_gate_config g on g.singleton
  where coalesce(i.license_status, '') = 'licensed'
    and i.created_at >= g.go_live_at
    and not exists (select 1 from public.aflac_submissions s where s.intake_id = i.id)
    and cardinality(public.aflac_intake_missing(i.first_name, i.last_name, i.email, i.npn, i.phone_e164, i.license_status, i.status)) = 0;

  v_req := public.fn_ntfy_relay(
    'Aflac check-off not done',
    case when v_ready > 0
      then v_ready || ' licensed hire(s) are still waiting to be sent to Aflac. Send them, then check off today.'
      else 'Nothing is waiting, but today is not checked off yet. Open the Aflac page and check off.'
    end,
    '4', 'warning', coalesce(nullif(p_topic, ''), 'sams-agent-yrkv9kbqp9e987nb')
  );

  return jsonb_build_object('sent', true, 'request_id', v_req, 'ready_unsent', v_ready);
end;
$$;

revoke all on function public.aflac_checkoff_reminder(text) from public, anon, authenticated;
grant execute on function public.aflac_checkoff_reminder(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'aflac-checkoff-reminder') then
    perform cron.unschedule('aflac-checkoff-reminder');
  end if;
  perform cron.schedule('aflac-checkoff-reminder', '0 0 * * *', 'select public.aflac_checkoff_reminder()');
end
$$;

commit;
