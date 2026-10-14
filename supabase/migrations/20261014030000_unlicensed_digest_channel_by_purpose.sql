-- PL-WIB-UNLICENSED-DIGEST-CHANNEL
--
-- The weekday #unlicensed digest has been refused by slack-announce on every
-- run since 2026-09-08. fn_post_unlicensed_digest sends channel
-- 'general-unlicensed'; slack-announce looks the room up by
-- messaging_destinations.channel_name; dd10ab97 (2026-09-07) repointed that row
-- to the live room and renamed it 'unlicensed'. No row matches, so the function
-- answers 404 "unknown channel: general-unlicensed" (function_edge_logs:
-- POST 404 slack-announce 2026-10-13T15:00:04Z), and automation_run_log still
-- records 'dispatched' every weekday.
--
-- Resolve the room by purpose, not by a name copied into a second place, so a
-- future rename cannot break it the same way. Exactly one enabled row must
-- carry the purpose: zero or several is logged as an error and nothing is
-- posted, because picking one of several would hide the ambiguity.
--
-- The old comment said "fn_check_unlicensed_digest_health below reads the
-- settled result". That function does not exist in this database and never
-- did, so 'dispatched' is the only record of a run and nothing settles it.
-- The comment now says so. Building that reader is a separate change.

create or replace function public.fn_post_unlicensed_digest()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req bigint;
  v_channel text;
  v_n int;
begin
  select count(*), min(channel_name)
    into v_n, v_channel
    from public.messaging_destinations
   where purpose = 'general_unlicensed' and is_enabled;

  if v_n <> 1 then
    insert into public.automation_run_log(job_name, status, error, created_at)
    values ('unlicensed_slack_digest', 'error',
            'expected 1 enabled messaging_destinations row with purpose general_unlicensed, found ' || v_n,
            now());
    return;
  end if;

  select net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/slack-announce',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token' limit 1),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'channel', v_channel,
      'text', public.fn_unlicensed_slack_digest()
    ),
    timeout_milliseconds := 30000
  ) into v_req;

  -- The response lands asynchronously (pg_net), so this records the DISPATCH
  -- only. Nothing reads the settled response yet (net._http_response, kept
  -- about 6 hours), so 'dispatched' is not evidence the post landed. Never
  -- claim delivery from the act of sending.
  insert into public.automation_run_log(job_name, status, error, created_at)
  values ('unlicensed_slack_digest', 'dispatched',
          'request_id=' || v_req::text || ' channel=' || v_channel, now());
exception when others then
  insert into public.automation_run_log(job_name, status, error, created_at)
  values ('unlicensed_slack_digest', 'error', sqlerrm, now());
end;
$function$;
