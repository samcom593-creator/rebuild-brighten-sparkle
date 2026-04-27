-- TikTok fan-monetization Phase 1 schema.
-- inbox = raw fan messages pulled from TikTok (manually or via the agent worker).
-- outbox = AI-classified replies queued for Sam's approval before send.

create table if not exists public.tiktok_inbox (
  id          uuid primary key default gen_random_uuid(),
  sender      text not null,
  message     text not null,
  received_at timestamptz not null default now(),
  source_url  text,
  metadata    jsonb default '{}'::jsonb,
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists tiktok_inbox_unreplied_idx
  on public.tiktok_inbox(received_at) where replied_at is null;

create table if not exists public.tiktok_outbox (
  id            uuid primary key default gen_random_uuid(),
  inbox_id      uuid references public.tiktok_inbox(id) on delete cascade,
  sender        text not null,
  reply_text    text not null,
  pitched_sku   text,
  status        text not null default 'pending_approval'
                check (status in ('pending_approval','approved','sent','rejected','failed')),
  approved_at   timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists tiktok_outbox_pending_idx
  on public.tiktok_outbox(created_at) where status = 'pending_approval';

alter table public.tiktok_inbox  enable row level security;
alter table public.tiktok_outbox enable row level security;

create policy "tiktok_admin_all_inbox" on public.tiktok_inbox
  for all using (public.has_role(auth.uid(), 'admin'::app_role));

create policy "tiktok_admin_all_outbox" on public.tiktok_outbox
  for all using (public.has_role(auth.uid(), 'admin'::app_role));

create policy "tiktok_service_inbox" on public.tiktok_inbox
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "tiktok_service_outbox" on public.tiktok_outbox
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Hourly cron — runs the fan monetizer to classify any new inbox entries.
select cron.schedule(
  'tiktok-fan-monetizer-hourly',
  '17 * * * *',
  $$SELECT net.http_post(
    url := 'https://msydzhzolwourcdmqxvn.supabase.co/functions/v1/tiktok-fan-monetizer',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    )
  ) as request_id;$$
);

comment on table public.tiktok_inbox  is 'Raw TikTok fan messages awaiting classification + reply.';
comment on table public.tiktok_outbox is 'AI-drafted replies pitching the right APEX offer; admin approves before send.';
