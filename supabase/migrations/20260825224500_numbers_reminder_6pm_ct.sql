-- One idempotent daily progress reminder at 6pm America/Chicago.
-- Two UTC cron entries cover daylight/standard time; the function itself
-- accepts only the invocation whose Chicago-local hour is 18.

begin;

create table if not exists public.numbers_reminder_delivery_log (
  business_date date not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  email text,
  sent_at timestamptz not null default now(),
  primary key (business_date, agent_id)
);

alter table public.numbers_reminder_delivery_log enable row level security;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'send-numbers-reminder',
    'apex-numbers-reminder',
    'apex-numbers-reminder-cdt',
    'apex-numbers-reminder-cst'
  );

  perform cron.schedule(
    'apex-numbers-reminder-cdt',
    '0 23 * * *',
    $cron$
      select net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/numbers-reminder',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token' limit 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cron$
  );

  perform cron.schedule(
    'apex-numbers-reminder-cst',
    '0 0 * * *',
    $cron$
      select net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/numbers-reminder',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='apex_bot_token' limit 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );
    $cron$
  );
end;
$$;

revoke all on table public.numbers_reminder_delivery_log from anon, authenticated;

commit;
