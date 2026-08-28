-- Monthly partition maintenance for audit_log + analytics_events.
--
-- WHY THIS EXISTS
-- ensure_next_month_partitions() was created 2026-04-17 and NEVER SCHEDULED:
-- no pg_cron job, no other function, no external caller referenced it. Both
-- partitioned parents therefore stop at *_2026_07, and every row written since
-- 2026-08-01 has landed in the DEFAULT partition (measured 2026-08-28:
-- audit_log_default 120 rows / 152 kB, analytics_events_default 644,026 rows /
-- 226 MB, still taking ~3,748 writes/hour). Nothing is lost and nothing is
-- broken for users -- the rows are still readable through the parent -- but
-- partition pruning is dead for those months and the repair cost grows every
-- month it stays unnoticed.
--
-- WHY MERELY SCHEDULING THE OLD FUNCTION WOULD NOT HAVE FIXED IT
-- The old body created exactly ONE month: date_trunc('month', now() + '2 months').
-- Run today (2026-08-27) it creates 2026_10 and nothing else, so August AND
-- September stay stranded forever -- September's gap being newly created by the
-- "fix" itself. A repair that cannot close the hole it is prescribed for is the
-- unactionable-remedy failure this codebase has shipped before; the function is
-- now gap-filling, so the remedy printed by monitoring genuinely works.
--
-- WHY THE DRAIN PATH IS NEEDED
-- Once DEFAULT holds rows for a month, CREATE TABLE ... PARTITION OF for that
-- range fails. Proven against prod in a self-rolling-back probe:
--   23514: updated partition constraint for default partition
--          "audit_log_default" would be violated by some row
-- So the rows must move OUT of default BEFORE the partition is attached.
--
-- The whole body is one implicit transaction: if any step fails, nothing
-- happens. Worst case is "no change", never a table left without its default
-- partition.

drop function if exists public.ensure_next_month_partitions();

create or replace function public.ensure_next_month_partitions()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  parents text[] := array['audit_log', 'analytics_events'];
  parent text;
  default_name text;
  part_name text;
  horizon date := date_trunc('month', now() + interval '2 months')::date;
  m_start date;
  m_end date;
  earliest date;
  stranded bigint;
  actions jsonb := '[]'::jsonb;
begin
  foreach parent in array parents loop
    default_name := parent || '_default';

    -- Start from the oldest month still stranded in DEFAULT, not from a fixed
    -- offset. This is what makes the function able to repair its own absence.
    execute format('select date_trunc(''month'', min(created_at))::date from public.%I', default_name)
      into earliest;

    m_start := least(
      coalesce(earliest, date_trunc('month', now())::date),
      date_trunc('month', now())::date
    );

    while m_start <= horizon loop
      m_end := (m_start + interval '1 month')::date;
      part_name := parent || '_' || to_char(m_start, 'YYYY_MM');

      if to_regclass('public.' || quote_ident(part_name)) is null then
        execute format(
          'select count(*) from public.%I where created_at >= %L and created_at < %L',
          default_name, m_start, m_end
        ) into stranded;

        if stranded = 0 then
          -- Nothing in default for this range: plain create, no lock, no scan.
          execute format(
            'create table public.%I partition of public.%I for values from (%L) to (%L)',
            part_name, parent, m_start, m_end
          );
          actions := actions || jsonb_build_object(
            'partition', part_name, 'action', 'created', 'rows_moved', 0);
        else
          -- SHARE ROW EXCLUSIVE conflicts with ROW EXCLUSIVE, so concurrent
          -- INSERTs block for the duration. Without it a row arriving between
          -- the DELETE and the ATTACH lands in default and the ATTACH fails
          -- with 23514 -- the same error this whole path exists to avoid.
          execute format('lock table public.%I in share row exclusive mode', parent);
          execute format(
            'create table public.%I (like public.%I including defaults including constraints)',
            part_name, parent);
          execute format(
            'with moved as (delete from public.%I where created_at >= %L and created_at < %L returning *) '
            || 'insert into public.%I select * from moved',
            default_name, m_start, m_end, part_name);
          execute format(
            'alter table public.%I attach partition public.%I for values from (%L) to (%L)',
            parent, part_name, m_start, m_end);
          actions := actions || jsonb_build_object(
            'partition', part_name, 'action', 'drained_and_attached', 'rows_moved', stranded);
        end if;
      end if;

      m_start := m_end;
    end loop;
  end loop;

  -- Returns receipts instead of void. A void maintenance function that never
  -- ran is indistinguishable from one that ran and had nothing to do, which is
  -- exactly how this went unnoticed from April to August.
  return jsonb_build_object('ran_at', now(), 'horizon', horizon, 'actions', actions);
end
$function$;

-- Single source of truth for "is partitioning healthy?", read by both the
-- function's caller and apex-doctor so the two cannot drift apart.
-- Always returns exactly one row per parent, in every state, so an empty
-- result can never be misread as health.
create or replace view public.v_partition_coverage as
with stranded as (
  select 'audit_log'::text as parent, count(*)::bigint as stranded_rows
    from public.audit_log_default
  union all
  select 'analytics_events'::text, count(*)::bigint
    from public.analytics_events_default
),
horizon as (
  select generate_series(
           date_trunc('month', now()),
           date_trunc('month', now() + interval '2 months'),
           interval '1 month'
         )::date as m
)
select
  s.parent,
  s.stranded_rows,
  count(*) filter (
    where to_regclass('public.' || s.parent || '_' || to_char(h.m, 'YYYY_MM')) is null
  )::bigint as missing_partitions,
  coalesce(string_agg(
    to_char(h.m, 'YYYY_MM'), ',' order by h.m
  ) filter (
    where to_regclass('public.' || s.parent || '_' || to_char(h.m, 'YYYY_MM')) is null
  ), '') as missing_months
from stranded s
cross join horizon h
group by s.parent, s.stranded_rows;

comment on view public.v_partition_coverage is
  'Monthly partition health for audit_log/analytics_events. stranded_rows>0 or missing_partitions>0 means ensure_next_month_partitions() has not run recently enough.';

-- Schedule it. The function existing but being scheduled by nothing is the
-- entire root cause of this migration, so the schedule ships in the same file
-- as the function and is idempotent on re-run.
-- Weekly against a +2 month horizon is ~8x the runway actually needed; the
-- steady-state run is cheap because the drain path only executes for a month
-- whose partition is genuinely absent.
do $$
begin
  perform cron.unschedule('apex-partition-maintenance-weekly');
exception when others then
  null; -- not previously scheduled
end
$$;

select cron.schedule(
  'apex-partition-maintenance-weekly',
  '0 6 * * 1',
  'select public.ensure_next_month_partitions()'
);
