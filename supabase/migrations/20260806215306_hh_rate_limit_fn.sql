-- Mirror of a migration applied live 2026-08-06 via Supabase MCP (recorded
-- remotely as 20260806215306_hh_rate_limit_fn). See 20260806214858 header for
-- why these mirrors exist.

create or replace function public.hh_rate_limit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into hh_rate_limits as r (bucket, count, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update set
    count = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.count + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning count into v_count;
  return v_count <= p_max;
end $$;

revoke execute on function public.hh_rate_limit(text, integer, integer) from public, anon, authenticated;
