-- Email-failure alarm graded on REAL recipients (head-to-toe audit 2026-08-27).
-- fn_email_failure_alarm counted test/placeholder failures (Resend rejects
-- example.com by design); one synthetic test-recruit-*@example.com loop
-- (1,846 failures since 2026-07-28, ~4/hr) fired a priority-5 "email pipeline
-- down" push to Sam's phone every hour for a month — training him to ignore
-- the one loud channel. Now it excludes test/placeholder addresses so only a
-- REAL outage pages; a genuine failure still fires.
create or replace function public.fn_email_failure_alarm()
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare v_fail int; v_sample text;
begin
  select count(*), max(f.error) into v_fail, v_sample
  from (
    select error, recipient_email from public.email_delivery_log
      where status='error' and created_at > now() - interval '65 minutes'
    union all
    select error_message, recipient_email from public.notification_log
      where channel='email' and status='failed' and created_at > now() - interval '65 minutes'
  ) f(error, recipient_email)
  where coalesce(f.recipient_email,'') !~* '(example\.com|test-recruit|placeholder|@test\.|\+test)';
  if coalesce(v_fail,0)=0 then return jsonb_build_object('alarm',false,'failures',0); end if;
  perform net.http_post(url:='https://ntfy.sh', headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('topic','sams-agent-yrkv9kbqp9e987nb','title','APEX email pipeline down','priority',5,
      'tags',jsonb_build_array('rotating_light'),
      'message','APEX EMAIL FAILING: '||v_fail||' send failures to REAL recipients in the last hour. Reason: '||coalesce(v_sample,'unknown')||'. New applicants are not being confirmed.'));
  return jsonb_build_object('alarm',true,'failures',v_fail,'reason',v_sample);
exception when others then return jsonb_build_object('alarm',false,'alarm_error',sqlerrm);
end;
$fn$;
