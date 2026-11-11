-- fn_private_surface_alert dedupes on the SET of holes, not the event type (2026-11-11).
-- At 20:45Z a false alarm (2 doors, money inbox) was paged; at ~21:05Z the deploy pipeline re-ran
-- 20261111203000 over the live lockdown and re-opened 12 real doors (admin DM functions + admin clip
-- policies). The audit saw all 12 within 15 min, but the 6-hour dedupe keyed on event_type only, so the
-- stale false alarm silenced the real breach. Now: a fingerprint (md5 of the sorted hole list) is
-- stamped in the alert body; only the SAME set is suppressed for 6h, any new/different set pages at once.
create or replace function public.fn_private_surface_alert()
returns integer language plpgsql security definer set search_path = public, pg_catalog as $$
declare n integer; v_detail text; v_fp text;
begin
  select count(*), string_agg(violation || ': ' || object, ' | ' order by violation, object)
    into n, v_detail from public.fn_private_surface_audit();
  if n = 0 then return 0; end if;
  v_fp := md5(v_detail);
  if exists (
    select 1 from public.bot_alerts
    where event_type = 'private_surface_violation' and created_at > now() - interval '6 hours'
      and body like '%fp:' || v_fp || '%'
  ) then return n; end if;
  insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
  values ('cron', 'private_surface_violation', 'critical',
          format('SECURITY: %s door(s) open to your private data', n),
          format('<p>Someone other than Sam can reach DMs / Instagram / camera library / Money Inbox.</p><p>%s</p><p>Run: select * from fn_private_surface_audit();</p><p style="color:#888">fp:%s</p>', left(v_detail, 1500), v_fp),
          format('APEX SECURITY: %s door(s) open to your DMs/camera. %s', n, left(v_detail, 200)),
          array['email']::text[]);
  perform net.http_post(
    url := 'https://ntfy.sh/',
    body := jsonb_build_object(
      'topic', 'sams-agent-yrkv9kbqp9e987nb',
      'title', 'APEX SECURITY: private data exposed',
      'message', format('%s door(s) open to your DMs/camera/Money Inbox: %s', n, left(v_detail, 400)),
      'priority', 5,
      'tags', jsonb_build_array('rotating_light')));
  return n;
end $$;
revoke all on function public.fn_private_surface_alert() from public, anon, authenticated;
