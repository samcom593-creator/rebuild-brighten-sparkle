-- MP-SITE-SPEED (2026-11-27): apex-ops-snapshot-prewarm ran every 2 minutes
-- (720 runs/day x 3.2 s avg = 2,326 s/day of a 1 GB Micro box that recorded six
-- "server restarted" cron failures in five days). The two keys it warms are
-- read behind fn_rpc_single_flight with TTLs of 300 s and 180 s, so a 5-minute
-- cadence would have let users recompute inline between prewarms. Both TTLs
-- move to 600 s FIRST (a prewarm every 5 min always lands inside the window),
-- then the cron moves to */5. Freshness of the admin ops tiles: 2 min -> 5 min.
--
-- Applied live via MCP apply_migration at 2026-11-27 15:34:59Z (this version
-- number is the one the platform recorded); this file is the repo's record.
do $$
declare
  v_def text;
  v_new text;
  v_pat text;
  v_hits int;
begin
  -- apex_admin_operations_snapshot: 300 -> 600
  v_def := pg_get_functiondef('public.apex_admin_operations_snapshot'::regproc);
  v_pat := '(''apex_admin_operations_snapshot:''\s*\|\|\s*coalesce\(auth\.uid\(\)::text,\s*''anon''\),\s*)300,';
  select count(*) into v_hits from regexp_matches(v_def, v_pat, 'g');
  if v_hits = 1 then
    v_new := regexp_replace(v_def, v_pat, '\1600,');
    execute v_new;
  elsif v_def !~ '''anon''\),\s*600,' then
    raise exception 'apex_admin_operations_snapshot: expected exactly 1 TTL site, found %', v_hits;
  end if;

  -- apex_dashboard_summary: 180 -> 600
  v_def := pg_get_functiondef('public.apex_dashboard_summary'::regproc);
  v_pat := '(''apex_dashboard_summary:global'',\s*)180,';
  select count(*) into v_hits from regexp_matches(v_def, v_pat, 'g');
  if v_hits = 1 then
    v_new := regexp_replace(v_def, v_pat, '\1600,');
    execute v_new;
  elsif v_def !~ 'global'',\s*600,' then
    raise exception 'apex_dashboard_summary: expected exactly 1 TTL site, found %', v_hits;
  end if;

  -- cron: */2 -> */5, by name so a renumbered job cannot be missed
  perform cron.alter_job(
    job_id => (select jobid from cron.job where jobname = 'apex-ops-snapshot-prewarm'),
    schedule => '*/5 * * * *');
end $$;
