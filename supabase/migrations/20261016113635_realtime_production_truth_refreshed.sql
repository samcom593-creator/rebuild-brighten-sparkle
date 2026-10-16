-- PL-REVIEW-P2 (2026-10-16): tell open pages when the production snapshot refreshes.
-- The scoreboard reads mv_production_comp_truth, refreshed by refresh_production_truth (pg_cron
-- every 5 minutes, after a 15 s debounce), while Total IMO by agency reads the live view. After a
-- deal the two disagreed until the next unrelated event, because nothing told the page the
-- snapshot had caught up. truth_refresh_state holds three operational rows (name, dirty,
-- refreshed_at, refresh_ms, last_error); every login can already read it. Publishing it lets the
-- scoreboard refetch the moment the 'production' row is marked refreshed.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'truth_refresh_state') then
    execute 'alter publication supabase_realtime add table public.truth_refresh_state';
  end if;
end $$;
