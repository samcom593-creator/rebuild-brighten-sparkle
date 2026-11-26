-- MP-SMB-BRAND-VIEWS-LIVE: brand_metrics_youtube_pull sourced views_total from SUM(content_posts.views),
-- but the YouTube content_posts Studio-sync froze 2026-11-02 (max stats_at + posted_at both Nov 2),
-- so views_total was pinned at 352,070 forever and the daily "views" delta was never written
-- (prev always equalled today). Repointed views_total to the SAME live blob the followers leg reads
-- (system_settings.youtube_channel_stats.total_views, healed <48h by fn_brand_youtube_stats_refresh
-- from the bot's 3x/day snapshot). content_posts kept as fallback. Daily delta now gap-guarded (<=2d)
-- so the 10-day source switchover is not dumped as a false +75k single-day spike.
-- Applied live via bot-sql 2026-11-13; this file is the source-of-truth round-trip.

CREATE OR REPLACE FUNCTION public.brand_metrics_youtube_pull()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  raw jsonb; d date; subs numeric; total numeric; prev numeric; prev_date date;
  wrote int := 0; views_src text;
begin
  select value::jsonb into raw from system_settings where key = 'youtube_channel_stats';
  if raw is null then return jsonb_build_object('ok', false, 'reason', 'no youtube_channel_stats'); end if;
  if jsonb_typeof(raw) = 'string' then raw := (raw #>> '{}')::jsonb; end if;
  d := ((raw->>'at')::timestamptz at time zone 'America/Phoenix')::date;
  subs := nullif(raw->>'subscribers', '')::numeric;
  if d is null then return jsonb_build_object('ok', false, 'reason', 'no sync timestamp'); end if;

  -- followers: live subscriber count from the self-healed blob
  if subs is not null then
    insert into brand_metrics_daily (metric_date, account, metric, value, source)
    values (d, 'youtube', 'followers', subs, 'youtube_sync')
    on conflict (metric_date, account, metric) do update set value = excluded.value, updated_at = now()
      where brand_metrics_daily.source = 'youtube_sync';
    wrote := wrote + 1;
  end if;

  -- views_total: channel-lifetime views from the SAME live blob. fn_brand_youtube_stats_refresh
  -- writes total_views from the bot's <48h snapshot. SUM(content_posts.views) is the dead
  -- Studio-sync proxy (frozen 2026-11-02), kept only as a fallback so we never write nothing.
  total := nullif(raw->>'total_views', '')::numeric;
  views_src := 'blob';
  if total is null then
    select sum(views) into total from content_posts where platform = 'youtube';
    views_src := 'content_posts_fallback';
  end if;

  if total is not null then
    select value, metric_date into prev, prev_date from brand_metrics_daily
     where account = 'youtube' and metric = 'views_total' and metric_date < d
     order by metric_date desc limit 1;

    insert into brand_metrics_daily (metric_date, account, metric, value, source)
    values (d, 'youtube', 'views_total', total, 'youtube_sync')
    on conflict (metric_date, account, metric) do update set value = excluded.value, updated_at = now()
      where brand_metrics_daily.source = 'youtube_sync';
    wrote := wrote + 1;

    -- daily delta: only across a <=2 day gap, so the 10-day source switchover
    -- (352,070 content_posts -> 427,803 live) is NOT dumped into one day as a false +75k spike.
    if prev is not null and prev_date is not null and total >= prev and (d - prev_date) <= 2 then
      insert into brand_metrics_daily (metric_date, account, metric, value, source)
      values (d, 'youtube', 'views', total - prev, 'youtube_sync')
      on conflict (metric_date, account, metric) do update set value = excluded.value, updated_at = now()
        where brand_metrics_daily.source = 'youtube_sync';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'wrote', wrote, 'as_of', d, 'views_total', total, 'views_source', views_src);
end $function$;
