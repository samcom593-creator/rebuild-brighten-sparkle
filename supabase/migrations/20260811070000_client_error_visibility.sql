-- Client error visibility.
--
-- error_logs has been collecting real production crashes since 2026: 1,049 rows,
-- 74 in the last 30 days, newest 3 hours before this migration. Nothing in the
-- product has ever read it and nothing alerts on it. Collection without
-- surfacing is not monitoring — it is a table that grows.
--
-- The rows are not homogeneous, and treating them as one number would produce a
-- scary count made almost entirely of noise:
--
--   * "Failed to fetch dynamically imported module: .../SessionWarningDialog-<hash>.js"
--     is a client holding an index.html from a previous deploy asking for a chunk
--     hash that no longer exists. src/lib/chunkRecovery.ts already detects and
--     self-heals these with a reload. They are expected background noise on every
--     deploy and must not page anyone.
--   * "Minified React error #310" (rendered more hooks than during the previous
--     render) on /dashboard/call-center, 13 hits across 2 real users, is an actual
--     crash that took a daily-driver page down and nobody found out.
--
-- So the view classifies before it counts. A dashboard that cannot tell those two
-- apart trains its reader to ignore it, which is how the cron gate earned 36 false
-- pages a day in the same week this was written.

create or replace view public.v_client_error_summary as
with classified as (
  select
    id,
    created_at,
    user_id,
    url,
    error_message,
    case
      when error_message ilike '%dynamically imported module%'
        or error_message ilike '%Loading chunk%'
        or error_message ilike '%Importing a module script failed%'
        or error_message ilike '%error loading dynamically imported%'
        then 'stale_deploy'
      else 'crash'
    end as error_class
  from public.error_logs
)
select
  error_class,
  left(error_message, 160)                                as error_message,
  count(*)                                                as hits,
  count(distinct user_id) filter (where user_id is not null) as affected_users,
  min(created_at)                                         as first_seen,
  max(created_at)                                         as last_seen,
  (array_agg(url order by created_at desc))[1]            as latest_url
from classified
where created_at > now() - interval '30 days'
group by error_class, left(error_message, 160);

comment on view public.v_client_error_summary is
  'Front-end errors from the last 30 days, grouped and classified. error_class=stale_deploy is self-healing chunk staleness handled by chunkRecovery.ts and is informational only; error_class=crash is a real front-end failure a user actually hit.';

grant select on public.v_client_error_summary to authenticated;
