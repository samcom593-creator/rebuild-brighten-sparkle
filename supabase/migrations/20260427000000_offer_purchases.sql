-- Unified offer purchase ledger.
-- Tracks every Stripe purchase across the 4 SKUs:
--   gold              — weekly subscription, $250/wk
--   platinum          — weekly subscription, $500/wk
--   auto_dm           — one-time package,    $250
--   social_growth     — one-time package,    $500
--
-- Lead subscriptions still write to lead_purchase_requests for back-compat;
-- this table is the source of truth for ALL offers.

create table if not exists public.offer_purchases (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete set null,
  agent_id            uuid references public.agents(id) on delete set null,
  purchaser_email     text not null,
  purchaser_name      text,
  sku                 text not null check (sku in ('gold','platinum','auto_dm','social_growth')),
  package_name        text not null,
  amount_cents        integer not null,
  currency            text not null default 'usd',
  mode                text not null check (mode in ('subscription','payment')),
  stripe_session_id   text unique,
  stripe_payment_intent text,
  stripe_subscription_id text,
  stripe_customer_id  text,
  status              text not null default 'paid' check (status in ('paid','refunded','disputed','canceled')),
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  notified_at         timestamptz
);

create index if not exists offer_purchases_agent_id_idx     on public.offer_purchases(agent_id);
create index if not exists offer_purchases_user_id_idx      on public.offer_purchases(user_id);
create index if not exists offer_purchases_sku_idx          on public.offer_purchases(sku);
create index if not exists offer_purchases_created_at_idx   on public.offer_purchases(created_at desc);

alter table public.offer_purchases enable row level security;

-- Admins see + manage everything
create policy "offer_purchases_admin_all" on public.offer_purchases
  for all using (public.has_role(auth.uid(), 'admin'::app_role));

-- Managers see purchases for any agent
create policy "offer_purchases_manager_select" on public.offer_purchases
  for select using (public.has_role(auth.uid(), 'manager'::app_role));

-- Agents/users see their own purchases (by user_id OR by their agent record)
create policy "offer_purchases_own" on public.offer_purchases
  for select using (
    user_id = auth.uid()
    or agent_id in (select id from public.agents where user_id = auth.uid())
  );

-- Service role bypass (used by stripe webhook)
create policy "offer_purchases_service" on public.offer_purchases
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Trigger an SMS + email alert on every new paid purchase.
-- Uses the existing bot_alerts queue (apex-alert-dispatch flushes it every 5 min;
-- the celebrate severity also fires immediate SMS via the existing dispatcher).
create or replace function public.fn_offer_purchase_notify()
returns trigger language plpgsql security definer as $$
declare
  amt_dollars numeric := (new.amount_cents::numeric) / 100;
  sev text := case when new.amount_cents >= 50000 then 'celebrate' else 'info' end;
begin
  if new.status = 'paid' and new.notified_at is null then
    insert into public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
    values (
      'trigger',
      'offer_purchase',
      sev,
      format('💰 New purchase: %s — $%s', new.package_name, amt_dollars::text),
      format(
        E'New paid purchase\n\nPackage: %s (%s)\nAmount: $%s %s\nBuyer: %s <%s>\nMode: %s\nAgent: %s\nWhen: %s',
        new.package_name, new.sku, amt_dollars::text, upper(new.currency),
        coalesce(new.purchaser_name, '—'), new.purchaser_email,
        new.mode, coalesce(new.agent_id::text, '—'), new.created_at::text
      ),
      format('💰 %s — $%s from %s', new.package_name, amt_dollars::text, new.purchaser_email),
      array['email','sms']::text[]
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_offer_purchase_notify on public.offer_purchases;
create trigger trg_offer_purchase_notify
  after insert on public.offer_purchases
  for each row execute function public.fn_offer_purchase_notify();

comment on table public.offer_purchases is
  'Unified Stripe purchase ledger across all 4 monetised offers. Webhook writes here; trigger queues alerts to Sam.';
