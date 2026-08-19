-- 2026-08-19: AdminFunnelHealth has called next_step_message_stats_24h since it
-- shipped. The function never existed (pg_proc: 0 rows), so the page silently
-- used its client-side fallback on every load. Found by the whole-app RPC
-- existence audit (58 distinct RPCs; this and get_just_hired_30d were the only
-- two missing). Applied live via bot-sql the same day; mirrored here so CI's
-- db push and the repo agree (apex_mcp_migrations_must_mirror).
create or replace function public.next_step_message_stats_24h(since_ts timestamptz)
returns table(channel text, sent bigint, failed bigint)
language sql stable security definer set search_path=public as $$
  select channel::text,
         count(*) filter (where sent_at is not null and failed_at is null) as sent,
         count(*) filter (where failed_at is not null) as failed
  from next_step_messages
  where created_at >= since_ts
  group by channel
$$;
grant execute on function public.next_step_message_stats_24h(timestamptz) to authenticated;
