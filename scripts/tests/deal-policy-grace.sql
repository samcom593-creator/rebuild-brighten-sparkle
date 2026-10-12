-- Run via bot-sql after the grace migration. All calls intentionally stop at validation; no deal is posted.
begin;
create temp table grace_results(test text,passed boolean);
do $test$
declare payload jsonb; carrier uuid; msg text; n integer; policy text;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from public.agents where user_id is not null and canonical_agent_id is null and status='active' limit 1),'role','authenticated')::text,true);
 select id into carrier from public.carriers where coalesce(is_active,true) limit 1;
 payload := jsonb_build_object('clientFirstName','Grace','clientLastName','Validation','clientPhone','6025550199','clientDob','1990-01-01','carrierId',carrier,'product','Validation only','policyNumber','','premiumMode','validation_sentinel');
 foreach n in array array[0,30,31,-1] loop
  begin
   perform public.submit_apex_deal_ledger_impl(gen_random_uuid(),payload || jsonb_build_object('applicationDate',(current_date-n)::text));
   msg := 'unexpected success';
  exception when others then msg := sqlerrm;
  end;
  insert into grace_results values ('age '||n, msg = case when n in (0,30) then 'Premium mode is invalid' when n=31 then 'An application or policy number is required more than 30 days after the sale date' else 'Application date cannot be in the future' end);
 end loop;
 begin
  perform public.submit_apex_deal_ledger_impl(gen_random_uuid(),payload || jsonb_build_object('applicationDate',(current_date-31)::text,'policyNumber','GRACE-TEST-'||gen_random_uuid()::text));
 exception when others then msg := sqlerrm;
 end;
 insert into grace_results values ('older deal with number passes policy gate',msg='Premium mode is invalid');
 select policy_number into policy from public.deals where nullif(btrim(policy_number),'') is not null limit 1;
 begin
  perform public.submit_apex_deal_ledger_impl(gen_random_uuid(),payload || jsonb_build_object('applicationDate',current_date::text,'policyNumber',policy));
 exception when others then msg := sqlerrm;
 end;
 insert into grace_results values ('known number still rejects duplicate',msg='A deal with this application or policy number already exists');
end $test$;
select test,passed from grace_results;
rollback;
