CREATE OR REPLACE VIEW public.v_agentlink_book_freshness AS
SELECT
  max(b.posted_date)                    AS latest_posted,
  max(b.imported_at)                    AS last_import,
  count(*)                              AS deals,
  (now()::date - max(b.posted_date))    AS days_since_last_posted,
  -- MP-435: last_import is max(imported_at). Since MP-431 put
  -- zz_suppress_noop_update('imported_at') on this table, a rebuild that finds
  -- no content change writes NOTHING, so imported_at does not move. That is
  -- correct behaviour and the whole point of the fix -- but it means
  -- last_import now answers "when did a row last CHANGE", not "when did we
  -- last successfully sync". Proven 2026-09-05: five successful rebuilds from
  -- 1,734 live deals (02:57, 03:20, 04:34, 05:49, 07:08Z) left last_import
  -- frozen at 2026-09-04T23:08:22Z. Anything grading staleness on the
  -- obviously-named column would go red on a healthy, actively-syncing book.
  max(b.imported_at)                    AS last_content_change,
  nullif(trim(both '"' from (
    SELECT s.value::text FROM public.system_settings s
    WHERE s.key = 'agentlink_book_last_refreshed_at'
  )), '')::timestamptz                  AS last_successful_refresh
FROM public.agentlink_book b;
