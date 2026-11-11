-- MP-DIALER-BILLING-PAUSE (2026-11-11).
--
-- ReadyMode canceled the Apex account for non-payment on 2026-11-10 09:25Z (vendor mail to the Neo
-- mailbox: five failed charges of $1,387.61, then "Account Canceled"). Nobody can dial. But
-- generate_weekly_dialer_invoices() still bills every active agent with has_dialer_login $100 per
-- week (5 agents, 8 weeks since 09-21, $4,000 due, $0 paid; newest week created 11-09) and bumps
-- older weeks to 'overdue'. Its caller is outside this repo (no pg_cron job, no src/function call),
-- so the stop has to live in the function.
--
-- system_settings.dialer_billing_paused = 'true' makes it a no-op (returns 0, inserts nothing,
-- flags nothing overdue). Existing rows are untouched: what agents owe for weeks they had a seat is
-- Sam's call, not a migration's. Resume by setting the flag to 'false' once ReadyMode is paid.
insert into public.system_settings (key, value)
values ('dialer_billing_paused', 'true')
on conflict (key) do update set value = 'true', updated_at = now();

create or replace function public.generate_weekly_dialer_invoices(target_week date default null::date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  wk date := coalesce(target_week, date_trunc('week', current_date)::date);
  n_inserted int;
begin
  if coalesce((select lower(btrim(value)) from public.system_settings where key = 'dialer_billing_paused'), 'false') = 'true' then
    return 0;
  end if;
  insert into public.dialer_weekly_payments (agent_id, week_start, amount_due, paid_status)
  select a.id, wk, 100.00, 'pending'
  from public.agents a
  where a.status = 'active' and a.has_dialer_login = true
  on conflict (agent_id, week_start) do nothing;
  get diagnostics n_inserted = row_count;
  update public.dialer_weekly_payments
    set paid_status = 'overdue', updated_at = now()
    where paid_status = 'pending' and week_start < wk;
  return n_inserted;
end;
$function$;
