-- Auto-dispatch fires when a NEW message lands in next_step_messages.
create or replace function public.fn_next_step_messages_auto_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_url   text;
  v_anon  text;
  v_req_id bigint;
begin
  if new.sent_at is not null or new.failed_at is not null then
    return new;
  end if;

  select value into v_url  from public.system_settings where key='supabase_url' limit 1;
  select value into v_anon from public.system_settings where key='supabase_anon_key' limit 1;
  if v_url is null or v_anon is null then
    raise notice 'fn_next_step_messages_auto_dispatch: missing supabase_url or supabase_anon_key';
    return new;
  end if;

  begin
    select net.http_post(
      url     := rtrim(v_url, '/') || '/functions/v1/next-step-dispatch',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_anon),
      body    := jsonb_build_object('message_id', new.id::text),
      timeout_milliseconds := 10000
    ) into v_req_id;
  exception when others then
    raise notice 'fn_next_step_messages_auto_dispatch failed: %', sqlerrm;
  end;

  return new;
end;
$body$;

drop trigger if exists trg_next_step_messages_auto_dispatch on public.next_step_messages;
create trigger trg_next_step_messages_auto_dispatch
  after insert on public.next_step_messages
  for each row
  when (new.sent_at is null and new.failed_at is null)
  execute function public.fn_next_step_messages_auto_dispatch();
