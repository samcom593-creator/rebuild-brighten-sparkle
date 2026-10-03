-- The "backtracking event": the moment a new Instagram token lands (Sam taps
-- Allow -> instagram-auth upserts system_settings.meta_instagram_token), replay
-- every assistant reply that died on the dead token. 2026-10-01..03: 305 DMs
-- and every "apex" commenter were lost, with nothing scheduled to make them whole.
-- Runs AFTER the row commits via pg_net, so a slow replay never blocks the upsert.
create or replace function public.fn_instagram_token_replay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.key = 'meta_instagram_token' and new.value is not null and new.value <> ''
     and (tg_op = 'INSERT' or new.value is distinct from old.value) then
    perform net.http_post(
      url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/instagram-dm-replay?include_failed=1&since=2026-10-01T14:00:00Z',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'apex_bot_token'),
        'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000);
  end if;
  return new;
exception when others then
  -- never let the replay kick-off roll back the token write itself
  raise warning 'fn_instagram_token_replay: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_instagram_token_replay on public.system_settings;
create trigger trg_instagram_token_replay
  after insert or update of value on public.system_settings
  for each row execute function public.fn_instagram_token_replay();
