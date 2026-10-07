-- PL-WIB-ALERT-DISPATCH-AUTH (2026-10-07). Hand-applied via bot-sql before this
-- commit so there was no window where apex-alert-dispatch refused the trigger;
-- CREATE OR REPLACE makes the CI re-apply a no-op. Only the credential changed:
-- supabase_anon_key (public, ships in the bundle) -> service_role_key.

CREATE OR REPLACE FUNCTION public.fn_agent_license_returned_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rows        integer := 0;
  v_url         text;
  v_key         text;
  v_name        text;
  v_email       text;
  v_npn         text;
  v_subject     text;
  v_sms         text;
  v_html        text;
  v_req_id      bigint;
begin
  -- Genuine transition into licensed only.
  if new.license_status::text is distinct from 'licensed' then
    return new;
  end if;
  if old.license_status::text is not distinct from new.license_status::text then
    return new;
  end if;

  -- Claim the alert. If a row already exists (backfill seed, or a previous
  -- transition), this inserts nothing and we send nothing.
  insert into public.agent_license_alerts
    (agent_id, milestone, prev_status, new_status, status)
  values
    (new.id, 'licensed', old.license_status::text, new.license_status::text, 'pending')
  on conflict (agent_id, milestone) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return new;
  end if;

  select p.full_name, p.email
    into v_name, v_email
  from public.profiles p
  where p.id = new.profile_id;

  v_name  := coalesce(nullif(btrim(coalesce(v_name, '')), ''), new.display_name, 'Agent ' || new.id::text);
  v_npn   := nullif(btrim(coalesce(new.nipr_number, '')), '');

  v_subject := format('LICENSE BACK — %s is field-ready', v_name);
  v_sms     := format('APEX: %s license came back. NPN %s. Contract + field-ready now.',
                      v_name, coalesce(v_npn, 'not on file'));
  v_html    := format(
    '<p><strong>%s just came back licensed.</strong></p>'
    || '<p>Email: %s<br/>NPN: %s<br/>License #: %s<br/>States: %s<br/>NIPR verified: %s</p>'
    || '<p>Next: get them contracted and into the field.</p>'
    || '<p><a href="https://apex-financial.org/dashboard/crm">Open CRM</a></p>',
    v_name,
    coalesce(v_email, '—'),
    coalesce(v_npn, 'not on file'),
    coalesce(nullif(btrim(coalesce(new.license_number, '')), ''), '—'),
    coalesce(array_to_string(new.license_states, ', '), '—'),
    case when new.nipr_verified then 'yes' else 'NO — self-reported' end);

  select value into v_url from public.system_settings where key = 'supabase_url';
  -- PL-WIB-ALERT-DISPATCH-AUTH: the service key, not the anon key. The anon key
  -- ships in the public bundle, so apex-alert-dispatch now refuses it on the
  -- ad-hoc path (anyone holding it could page Sam on 4 channels with their own
  -- link). 'service_role_key' is what run_automation_job, applicant_login_send
  -- and schedule_auto_populate_tick already send.
  select value into v_key from public.system_settings where key = 'service_role_key';
  if v_url is null then v_url := 'https://xrzweoneiieddzxogewk.supabase.co'; end if;

  if v_key is null then
    -- No creds = no send. Record the failure honestly instead of leaving a
    -- 'pending' row that looks like it is merely in flight.
    update public.agent_license_alerts
       set status = 'failed',
           last_error = 'service_role_key missing from system_settings'
     where agent_id = new.id and milestone = 'licensed';
    return new;
  end if;

  -- One POST. apex-alert-dispatch inserts its own bot_alerts row and, because
  -- severity='celebrate' is STANDALONE, immediately fans out to ntfy + email +
  -- Discord + SMS. We do not insert bot_alerts ourselves — that would either
  -- double-send or race the dispatcher.
  select net.http_post(
    url     := v_url || '/functions/v1/apex-alert-dispatch',
    body    := jsonb_build_object(
                 'source',      'trigger',
                 'event_type',  'agent_license_returned',
                 'severity',    'celebrate',
                 'subject',     v_subject,
                 'body',        v_html,
                 'sms_body',    v_sms,
                 'action_link', 'https://apex-financial.org/dashboard/crm',
                 'channels',    jsonb_build_array('email', 'sms', 'discord', 'ntfy')),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key,
                 'apikey',        v_key)
  ) into v_req_id;

  -- pg_net is fire-and-forget: the response is NOT visible in this
  -- transaction (see memory apex_pg_net_visibility). So we record
  -- 'dispatch_requested', never 'sent'. v_agent_license_alert_health below
  -- reconciles against bot_alerts to prove whether it actually landed.
  update public.agent_license_alerts
     set status = 'dispatch_requested',
         dispatch_requested_at = now(),
         net_request_id = v_req_id
   where agent_id = new.id and milestone = 'licensed';

  return new;
end;
$function$;
