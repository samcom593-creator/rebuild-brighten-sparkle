-- Enable realtime publication on offer_purchases so the dashboard
-- PaymentSoundListener + ProfitReveal can react instantly when a sale lands.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'offer_purchases'
  ) then
    alter publication supabase_realtime add table public.offer_purchases;
  end if;
end $$;

-- Hourly cron to run the offers monitoring + nudge engine.
-- Hour cadence avoids spamming Sam — the existing apex-alert-dispatch then
-- batches anything queued. Run at :07 to dodge the top-of-hour cron herd.
select cron.schedule(
  'offers-monetization-monitor-hourly',
  '7 * * * *',
  $$SELECT net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/offers-monetization-monitor',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  ) as request_id;$$
);
