begin;

-- MP-347b: the digest must not fail silently into an archived room.
--
-- slack-announce reported honestly that it cannot unarchive #general-unlicensed
-- (unarchive_failed:missing_scope — the bot has no channels:manage). That is a
-- one-click fix for a Slack admin, but until it happens a daily cron would POST
-- into the void every weekday and nothing would say so: pg_net swallows the
-- response, and a 502 recorded in net._http_response is not a place anyone
-- looks. Same shape as the alert channel that was 60% one dead integration.
--
-- So the digest goes through a wrapper that records EVERY attempt and its
-- outcome in automation_run_log, where apex-doctor and the ops surfaces already
-- read. A digest that cannot deliver is now a visible fact.
create or replace function public.fn_post_unlicensed_digest()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req bigint;
begin
  select net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/slack-announce',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token' limit 1),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'channel', 'general-unlicensed',
      'text', public.fn_unlicensed_slack_digest()
    ),
    timeout_milliseconds := 30000
  ) into v_req;

  -- The response lands asynchronously (pg_net), so this records the DISPATCH,
  -- and fn_check_unlicensed_digest_health below reads the settled result. Never
  -- claim delivery from the act of sending — that is the fake-success pattern.
  insert into public.automation_run_log(job_name, status, error, created_at)
  values ('unlicensed_slack_digest', 'dispatched', 'request_id=' || v_req::text, now());
exception when others then
  insert into public.automation_run_log(job_name, status, error, created_at)
  values ('unlicensed_slack_digest', 'error', sqlerrm, now());
end;
$function$;

-- Reads the SETTLED pg_net response for the most recent dispatch, so "did the
-- digest actually land" is answerable rather than assumed.
create or replace function public.fn_unlicensed_digest_health()
returns table(last_attempt timestamptz, http_status integer, verdict text, detail text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with last_dispatch as (
    select created_at,
           nullif(regexp_replace(coalesce(error,''), '\D', '', 'g'), '')::bigint as req_id
    from public.automation_run_log
    where job_name = 'unlicensed_slack_digest' and status = 'dispatched'
    order by created_at desc limit 1
  )
  select d.created_at,
         r.status_code,
         case
           when d.created_at is null then 'never_run'
           when r.status_code is null then 'no_response_recorded'
           when r.status_code = 200 and coalesce(r.content, '') like '%"ok":true%' then 'delivered'
           else 'refused'
         end,
         coalesce(left(r.content, 200), 'no response body')
  from last_dispatch d
  left join net._http_response r on r.id = d.req_id;
$function$;

select cron.unschedule(jobid) from cron.job where jobname = 'apex-unlicensed-slack-digest';
select cron.schedule('apex-unlicensed-slack-digest', '0 15 * * 1-5',
  $cron$ select public.fn_post_unlicensed_digest(); $cron$);

commit;
