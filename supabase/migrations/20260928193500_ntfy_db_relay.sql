-- ntfy.sh 429s edge-function egress (shared IPs), so lead pushes to Sam's phone were
-- refused while bot_alerts.sent_at said delivered. The database egresses from a
-- different IP that ntfy accepts. Relay = queue via pg_net, then read ntfy's reply in a
-- SEPARATE call (pg_net responses are invisible inside the queuing transaction).
create or replace function public.fn_ntfy_relay(p_title text, p_body text, p_priority text default '4', p_tags text default 'bell')
returns bigint language sql security definer set search_path = public, net as $$
  select net.http_post(
    url := 'https://ntfy.sh/',   -- JSON publish goes to the root; the topic URL treats JSON as plain text
    body := jsonb_build_object('topic','sams-agent-yrkv9kbqp9e987nb','title',left(p_title,200),'message',left(p_body,3000),'priority',coalesce(nullif(p_priority,'')::int,4),'tags',jsonb_build_array(p_tags)),
    headers := '{"Content-Type":"application/json"}'::jsonb
  );
$$;
-- ntfy's own message id when it accepted the push; null while pending or refused.
create or replace function public.fn_ntfy_relay_result(p_request_id bigint)
returns text language sql security definer set search_path = public, net as $$
  select case when status_code = 200 then coalesce(content::jsonb->>'id','ok') end
  from net._http_response where id = p_request_id;
$$;
revoke all on function public.fn_ntfy_relay(text,text,text,text) from public, anon, authenticated;
revoke all on function public.fn_ntfy_relay_result(bigint) from public, anon, authenticated;
grant execute on function public.fn_ntfy_relay(text,text,text,text) to service_role;
grant execute on function public.fn_ntfy_relay_result(bigint) to service_role;
