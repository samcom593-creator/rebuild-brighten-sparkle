begin;

-- PL-WIB-UNLICENSED-DIGEST-SETTLE: write the weekday #unlicensed digest's
-- answer onto its own run-log row before pg_net throws it away.
--
-- fn_post_unlicensed_digest records the DISPATCH only. fn_unlicensed_digest_health
-- (20260831290000) was meant to read the answer, but:
--   1. Nothing ever called it: no cron, no SQL caller, no src/ caller, no doctor
--      check. A month of 404s "unknown channel" (fixed in e30e1569) sat behind
--      31 rows that all said 'dispatched'.
--   2. It joined net._http_response live. pg_net keeps about 6 hours of
--      responses, so from ~21:00Z on a weekday, and all weekend, every digest
--      read 'no_response_recorded' whether it landed or not. The evidence
--      expired before anyone looked.
--   3. It took the request id with regexp_replace(error, '\D', ''), which
--      concatenates EVERY digit in the string. Since e30e1569 that string also
--      carries ' channel=<name>', so a digit in a channel name minted a wrong id.
--
-- Also, pg_net request ids are not identities: the sequence reset between
-- 2026-10-12 (request_id=142290) and 2026-10-13 (request_id=2855). Joining on
-- id alone would let an old row adopt an unrelated response once the counter
-- climbs back past it. The join here also requires the response to have been
-- written within 5 minutes after the dispatch (the post times out at 30s).
--
-- Settled states, written onto the dispatch row:
--   success    200 with "ok":true from slack-announce
--   error      any other answer, incl. pg_net timeout/error_msg (http_status
--              holds the code when there was one)
--   unsettled  no matching response and the row is past pg_net's retention.
--              Not a delivery and not a failure: nobody can know any more.
-- 'failed' is deliberately not used: trg_bot_alert_automation_failure turns it
-- into a bot_alerts email, and the 30 historical rows settle to 'unsettled' in
-- one pass, which must not page anyone.

create or replace function public.fn_settle_unlicensed_digest()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_answered integer;
  v_expired integer;
begin
  with pending as (
    select l.id,
           l.created_at,
           l.error as dispatch_note,
           (regexp_match(coalesce(l.error, ''), 'request_id=(\d+)'))[1]::bigint as req_id
      from public.automation_run_log l
     where l.job_name = 'unlicensed_slack_digest'
       and l.status = 'dispatched'
  ), answered as (
    select p.id,
           p.created_at,
           p.dispatch_note,
           r.status_code,
           r.content,
           r.timed_out,
           r.error_msg,
           r.created as answered_at,
           (r.status_code = 200 and coalesce(r.content, '') like '%"ok":true%') as landed
      from pending p
      join net._http_response r
        on r.id = p.req_id
       and r.created >= p.created_at
       and r.created <  p.created_at + interval '5 minutes'
  ), settled as (
    update public.automation_run_log l
       set status        = case when a.landed then 'success' else 'error' end,
           http_status   = a.status_code,
           completed_at  = a.answered_at,
           duration_ms   = greatest(0, (extract(epoch from (a.answered_at - a.created_at)) * 1000)::integer),
           response_body = jsonb_build_object(
                             'content',   left(coalesce(a.content, ''), 500),
                             'timed_out', a.timed_out,
                             'error_msg', a.error_msg),
           error         = case
                             when a.landed then a.dispatch_note
                             else 'refused http=' || coalesce(a.status_code::text, 'none') || ' '
                                  || left(coalesce(a.error_msg, a.content, ''), 200)
                                  || ' | ' || coalesce(a.dispatch_note, '')
                           end
      from answered a
     where l.id = a.id
    returning 1
  )
  select count(*) into v_answered from settled;

  update public.automation_run_log l
     set status = 'unsettled',
         error  = 'unsettled: no pg_net response found within its retention | ' || coalesce(l.error, '')
   where l.job_name = 'unlicensed_slack_digest'
     and l.status = 'dispatched'
     and l.created_at < now() - interval '6 hours';
  get diagnostics v_expired = row_count;

  return v_answered + v_expired;
end;
$function$;

revoke execute on function public.fn_settle_unlicensed_digest() from public, anon, authenticated;

-- Reads the verdict the settle step persisted, so the answer survives pg_net's
-- retention. Same columns as before; verdicts: never_run, pending, delivered,
-- refused (an HTTP answer that was not "ok":true), error (no HTTP answer: config
-- error, exception, pg_net timeout), unsettled.
create or replace function public.fn_unlicensed_digest_health()
returns table(last_attempt timestamptz, http_status integer, verdict text, detail text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with last_row as (
    select created_at, status, http_status, error
      from public.automation_run_log
     where job_name = 'unlicensed_slack_digest'
     order by created_at desc
     limit 1
  )
  select l.created_at,
         l.http_status,
         case
           when l.created_at is null then 'never_run'
           when l.status = 'dispatched' then 'pending'
           when l.status = 'success' then 'delivered'
           when l.status = 'unsettled' then 'unsettled'
           when l.status = 'error' and l.http_status is not null then 'refused'
           else 'error'
         end,
         coalesce(left(l.error, 300), 'no detail')
    from (select 1) one
    left join last_row l on true;
$function$;

revoke execute on function public.fn_unlicensed_digest_health() from public, anon, authenticated;

-- Hourly: a 15:00Z dispatch gets six settle attempts inside pg_net's ~6h
-- retention, which also covers manual fires at other hours and a dropped
-- pg_cron start ("job startup timeout", MP-366).
select cron.unschedule(jobid) from cron.job where jobname = 'apex-unlicensed-digest-settle';
select cron.schedule('apex-unlicensed-digest-settle', '7 * * * *',
  $cron$ select public.fn_settle_unlicensed_digest(); $cron$);

commit;
