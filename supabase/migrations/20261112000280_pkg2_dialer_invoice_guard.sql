-- MP-ONBOARD-ANCHOR-PKG2 (2026-11-12) — licensed-hire activation, part 10 of 11: no dialer invoices while there is no dialer.
--
-- WHAT
--   1. generate_weekly_dialer_invoices(target_week) writes NOTHING (no new $100 rows, no pending->overdue bump) and
--      returns 0 while system_settings.dialer_status <> 'active'. Same signature, same grants; search_path pinned.
--   2. A BEFORE INSERT guard on dialer_weekly_payments drops any new row (with a WARNING naming the cause) while
--      the dialer is not active, so a writer outside that function cannot bill either.
--   Existing rows are untouched: what is already billed is a money decision, not a code change.
--
-- WHY
--   readymode_block 5c/7: dialer_weekly_payments bills 5 agents $100 every week (09-28 to 11-09: $3,500 due, $0
--   paid); the 11-09 week was created the day before ReadyMode canceled the account for non-payment.
--   The writer is generate_weekly_dialer_invoices (one bulk INSERT ... ON CONFLICT per week; rows share one
--   created_at). It is NOT a pg_cron job and NOT a trigger (cron.job and pg_trigger checked 2026-11-11), it is not
--   called from the repo, business-ops or launchd, and it is service_role-only, so its weekly caller is an external
--   service-role client (bot-sql or an edge function outside the repo). Guarding the function and the table stops
--   it whichever client fires.

create or replace function public.generate_weekly_dialer_invoices(target_week date default null::date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  wk date := coalesce(target_week, date_trunc('week', current_date)::date);
  n_inserted int;
begin
  -- PKG2 (2026-11-12): the dialer was canceled for non-payment on 2026-11-10. Bill nothing while it is not active.
  if coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') <> 'active' then
    raise notice 'generate_weekly_dialer_invoices: dialer_status is not active; no invoices written';
    return 0;
  end if;
  insert into public.dialer_weekly_payments (agent_id, week_start, amount_due, paid_status)
  select a.id, wk, 100.00, 'pending'
  from public.agents a
  where a.status = 'active' and a.has_dialer_login = true
  on conflict (agent_id, week_start) do nothing;
  get diagnostics n_inserted = row_count;
  -- Auto-flag overdue: prior weeks still pending get bumped to 'overdue'
  update public.dialer_weekly_payments
    set paid_status = 'overdue', updated_at = now()
    where paid_status = 'pending' and week_start < wk;
  return n_inserted;
end;
$$;

revoke all on function public.generate_weekly_dialer_invoices(date) from public, anon, authenticated;
grant execute on function public.generate_weekly_dialer_invoices(date) to service_role;

create or replace function public.fn_dialer_invoice_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce((select lower(btrim(s.value)) from public.system_settings s where s.key = 'dialer_status'), 'unset') <> 'active' then
    raise warning 'dialer_weekly_payments: insert for agent % week % dropped; dialer_status is not active (canceled 2026-11-10)',
      new.agent_id, new.week_start;
    return null;
  end if;
  return new;
end;
$$;

comment on function public.fn_dialer_invoice_guard() is
  'PKG2: BEFORE INSERT guard on dialer_weekly_payments. While system_settings.dialer_status <> active a new invoice row is dropped (WARNING), so nobody is billed for a dialer that does not exist.';

revoke all on function public.fn_dialer_invoice_guard() from public, anon, authenticated;

drop trigger if exists trg_pkg2_dialer_invoice_guard on public.dialer_weekly_payments;
create trigger trg_pkg2_dialer_invoice_guard
  before insert on public.dialer_weekly_payments
  for each row execute function public.fn_dialer_invoice_guard();
