-- Venmo-only lead payment ledger fields.
-- Keeps the original weekly paid/unpaid tracker intact while adding the
-- operator fields needed to audit A/B/C/Free lead packs without Stripe.

alter table if exists public.lead_payment_tracking
  add column if not exists payment_method text not null default 'venmo',
  add column if not exists amount numeric(12,2) not null default 0,
  add column if not exists payment_date date,
  add column if not exists venmo_reference text,
  add column if not exists lead_type text,
  add column if not exists assigned_rep text,
  add column if not exists notes text,
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payer_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lead_payment_tracking_payment_method_check'
  ) then
    alter table public.lead_payment_tracking
      add constraint lead_payment_tracking_payment_method_check
      check (payment_method = 'venmo') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lead_payment_tracking_lead_type_check'
  ) then
    alter table public.lead_payment_tracking
      add constraint lead_payment_tracking_lead_type_check
      check (lead_type is null or lead_type in ('A', 'B', 'C', 'Free')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'lead_payment_tracking_payment_status_check'
  ) then
    alter table public.lead_payment_tracking
      add constraint lead_payment_tracking_payment_status_check
      check (payment_status in ('pending', 'confirmed', 'waived', 'issue')) not valid;
  end if;
end $$;

create index if not exists idx_lead_payment_tracking_payment_date
  on public.lead_payment_tracking(payment_date desc);

create index if not exists idx_lead_payment_tracking_status
  on public.lead_payment_tracking(payment_status, lead_type);
