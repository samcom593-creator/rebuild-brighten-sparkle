-- Retire the old contracting delivery pipeline (2026-10-09)
--
-- Contracting is now a manual portal tracker (migration 20261009180000): four carrier circles, a placement level and
-- five profile fields. The old pipeline that turned every contracting intake into a private-channel post, a spreadsheet
-- row and a Slack message is switched off here. NOTHING IS DELETED: the intakes, deliveries and outbox rows already
-- written stay exactly as they are, as history.
--
-- MEASURED BEFORE ACTING (2026-10-09, live):
--   * nothing from the old pipeline is waiting to send. contracting_discord deliveries: 55/55 delivered; the Slack
--     events: 33/33 delivered; ethos_sheet deliveries: 20 delivered, 6 manual_review, 29 not_configured; 36 outbox rows
--     for the sheet sit in manual_action_required (a human action, never retried by the dispatcher). No queued message
--     mentioning contracting exists in outreach_queue or sms_fallback_queue, and no stored template contains the retired
--     instructions.
--   * but the pipeline is still LIVE for new work: every hire made through the hire link or Add Agent created an
--     intake, and the intake's triggers created a Discord leg, a sheet leg and a Slack event (the newest at 22:39 UTC
--     today). Those three triggers are what this migration switches off.
--   * the nightly "Aflac check-off not done" push (cron aflac-checkoff-reminder) nags about a daily gate that the new
--     process replaces. It is paused, not removed.
--
-- WHAT THIS DOES (idempotent; reversible with the one-line hint stored beside each item):
--   1. contracting_legacy_retirements: the register of what was switched off, its prior state and how to switch it back.
--   2. disables trg_ensure_contracting_legs, trg_queue_contracting_slack and trg_queue_contracting_slack_npn_added.
--   3. pauses the cron job aflac-checkoff-reminder.
--   4. v_contracting_legacy_retirement: one row per item with the ACTUAL state read from the catalog, and
--      v_contracting_legacy_retired: ONE row that is false unless all four are still off (a missing registry reads false,
--      never blank-green).
--
-- Left running on purpose: contracting_intakes_enrich_profile (it copies an intake's contact details onto the profile and
-- sends nothing), the route-guard triggers (they only refuse bad destinations), the apex-outbox-dispatcher cron (it also
-- carries deal and hire notifications), and trg_auto_advance_licensed_to_contracting (an applicant status change, not a
-- message).

begin;

create table if not exists public.contracting_legacy_retirements (
  item text primary key,
  kind text not null check (kind in ('trigger', 'cron')),
  target text not null,
  expected_state text not null check (expected_state in ('disabled', 'inactive')),
  reason text not null,
  prior_state text,
  retired_at timestamptz not null default now(),
  revert_hint text not null
);
alter table public.contracting_legacy_retirements enable row level security;
revoke all on table public.contracting_legacy_retirements from public, anon, authenticated;
grant all on table public.contracting_legacy_retirements to service_role;
grant select on table public.contracting_legacy_retirements to authenticated;
drop policy if exists contracting_legacy_retirements_admin_read on public.contracting_legacy_retirements;
create policy contracting_legacy_retirements_admin_read on public.contracting_legacy_retirements for select to authenticated
  using (public.apex_is_admin());

-- ── 1. the three triggers that fed the old pipeline ────────────────────────────────────────────────────────────
-- prior_state is read BEFORE the switch, and only recorded once, so a re-run never overwrites what the pipeline was.

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('contracting_intakes.trg_ensure_contracting_legs', 'public.contracting_intakes', 'trg_ensure_contracting_legs',
       'Created a private-channel leg and a spreadsheet leg for every intake.'),
      ('contracting_intakes.trg_queue_contracting_slack', 'public.contracting_intakes', 'trg_queue_contracting_slack',
       'Queued a Slack event for every new intake.'),
      ('contracting_intakes.trg_queue_contracting_slack_npn_added', 'public.contracting_intakes', 'trg_queue_contracting_slack_npn_added',
       'Queued a Slack event when an intake gained an NPN.')
    ) as v(item, tbl, trg, why)
  loop
    if exists (select 1 from pg_trigger g where g.tgrelid = t.tbl::regclass and g.tgname = t.trg and not g.tgisinternal) then
      insert into public.contracting_legacy_retirements (item, kind, target, expected_state, reason, prior_state, revert_hint)
      select t.item, 'trigger', t.tbl || '.' || t.trg, 'disabled', t.why,
             (select case g.tgenabled when 'O' then 'enabled' when 'D' then 'disabled' else g.tgenabled::text end
                from pg_trigger g where g.tgrelid = t.tbl::regclass and g.tgname = t.trg),
             'alter table ' || t.tbl || ' enable trigger ' || t.trg
      on conflict (item) do nothing;
      execute format('alter table %s disable trigger %I', t.tbl, t.trg);
    end if;
  end loop;
end $$;

-- ── 2. the nightly Aflac check-off push ─────────────────────────────────────────────────────────────────────────

do $$
declare
  v_job bigint;
  v_active boolean;
begin
  if to_regclass('cron.job') is null then return; end if;
  select jobid, active into v_job, v_active from cron.job where jobname = 'aflac-checkoff-reminder';
  if v_job is null then return; end if;
  insert into public.contracting_legacy_retirements (item, kind, target, expected_state, reason, prior_state, revert_hint)
  values ('cron.aflac-checkoff-reminder', 'cron', 'aflac-checkoff-reminder', 'inactive',
          'Nightly push about a daily Aflac check-off gate the manual portal tracker replaces.',
          case when v_active then 'active' else 'inactive' end,
          'select cron.alter_job((select jobid from cron.job where jobname = ''aflac-checkoff-reminder''), active := true)')
  on conflict (item) do nothing;
  perform cron.alter_job(v_job, active := false);
end $$;

-- ── 3. proof it stays off ───────────────────────────────────────────────────────────────────────────────────────
-- Read from the catalog every time, never from the register's own claim. Service-role only: the cron table is not
-- readable by signed-in users.

create or replace view public.v_contracting_legacy_retirement as
select r.item, r.kind, r.target, r.expected_state, r.prior_state, r.retired_at, r.revert_hint,
       case r.kind
         when 'trigger' then (
           select case g.tgenabled when 'D' then 'disabled' else 'enabled' end
             from pg_trigger g
            where not g.tgisinternal
              and g.tgname = regexp_replace(r.target, '^.*\.', '')
              and g.tgrelid = to_regclass(regexp_replace(r.target, '\.[^.]+$', '')))
         when 'cron' then (
           select case when j.active then 'active' else 'inactive' end from cron.job j where j.jobname = r.target)
       end as actual_state
from public.contracting_legacy_retirements r;

-- ONE row in every state. The expected count is fixed here, so an empty or truncated register reads false instead of
-- passing for lack of anything to check.
create or replace view public.v_contracting_legacy_retired as
select
  (select count(*) from public.contracting_legacy_retirements)::int as registered,
  (select count(*) from public.v_contracting_legacy_retirement v where v.actual_state is not distinct from v.expected_state)::int as still_off,
  4 as expected_items,
  (   (select count(*) from public.contracting_legacy_retirements) = 4
  and (select count(*) from public.v_contracting_legacy_retirement v where v.actual_state is not distinct from v.expected_state) = 4) as retired_ok;

revoke all on public.v_contracting_legacy_retirement, public.v_contracting_legacy_retired from public, anon, authenticated;
grant select on public.v_contracting_legacy_retirement, public.v_contracting_legacy_retired to service_role;

commit;
