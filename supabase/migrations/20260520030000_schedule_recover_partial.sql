-- PL-087 · Schedule recover_partial_applications hourly.
-- RPC already exists; was never scheduled. 4 stuck partial applications
-- waiting on this as of cron-schedule time.

do $$ begin
  perform cron.schedule(
    'recover_partial_applications_hourly',
    '17 * * * *',
    $cron$ select public.recover_partial_applications(); $cron$
  );
exception when others then null; end $$;
